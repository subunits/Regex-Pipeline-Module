import re
import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, Union


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

PreProcessor  = Callable[[str], str]
CoreHandler   = Callable[[str], Any]          # str → SR string (or awaitable)
PostProcessor = Callable[[Any], Any]          # SR/any → scored result or next form


@dataclass
class SemanticRegex:
    """Parsed output from the explainer model."""
    raw: str                        # full model response
    sr: str                         # extracted SR expression
    explanation: str = ""           # prose before "SR:"


@dataclass
class PipelineResult:
    """What comes out the other end."""
    original: str
    prepped: str
    sr: SemanticRegex
    scores: Dict[str, Any] = field(default_factory=dict)
    meta: Dict[str, Any]   = field(default_factory=dict)


# ---------------------------------------------------------------------------
# SR parsing helper
# ---------------------------------------------------------------------------

_SR_PREFIX = re.compile(r"(?i)SR:\s*")

def parse_sr(raw: str) -> SemanticRegex:
    """
    Split explainer output into explanation prose and the SR expression.
    Handles both 'explanation. SR: [...]' and bare '[...]' responses.
    """
    match = _SR_PREFIX.search(raw)
    if match:
        explanation = raw[:match.start()].strip()
        sr_expr     = raw[match.end():].strip()
    else:
        explanation = ""
        sr_expr     = raw.strip()
    return SemanticRegex(raw=raw, sr=sr_expr, explanation=explanation)


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

class RegexPipeline:
    """
    Three-phase pipeline: pre-process → core → post-process.

    Pre-processors:  str  → str   (regex substitutions, normalization)
    Core handler:    str  → str   (explainer model call; sync or async)
    Post-processors: Any  → Any   (SR parsing, scoring, structured output)

    Unlike the original, post-processors are not forced to be str→str —
    they can return scores, dicts, or any structured result, and each
    stage receives the output of the previous one.
    """

    def __init__(self):
        self._pre:  List[Tuple[str, PreProcessor]]  = []
        self._post: List[Tuple[str, PostProcessor]] = []

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def add_pre(
        self,
        name: str,
        pattern: str,
        repl: Union[str, Callable],
        flags: int = 0,
    ) -> "RegexPipeline":
        """Add a regex substitution to the pre-processing stage."""
        compiled = re.compile(pattern, flags)           # compile once
        def _proc(text: str) -> str:
            return compiled.sub(repl, text)
        self._pre.append((name, _proc))
        return self

    def add_pre_fn(self, name: str, fn: PreProcessor) -> "RegexPipeline":
        """Add an arbitrary str→str function to the pre-processing stage."""
        self._pre.append((name, fn))
        return self

    def add_post_fn(self, name: str, fn: PostProcessor) -> "RegexPipeline":
        """
        Add a post-processing step. Receives whatever the previous step
        returned — not constrained to str→str.
        """
        self._post.append((name, fn))
        return self

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def _run_pre(self, text: str) -> str:
        for name, fn in self._pre:
            try:
                text = fn(text)
            except Exception as e:
                raise RuntimeError(f"Pre-processor '{name}' failed: {e}") from e
        return text

    def _run_post(self, value: Any) -> Any:
        for name, fn in self._post:
            try:
                value = fn(value)
            except Exception as e:
                raise RuntimeError(f"Post-processor '{name}' failed: {e}") from e
        return value

    def run(self, text: str, core_handler: CoreHandler) -> Any:
        """Synchronous execution."""
        prepped = self._run_pre(text)
        try:
            core_out = core_handler(prepped)
        except Exception as e:
            raise RuntimeError(f"Core handler failed: {e}") from e
        return self._run_post(core_out)

    async def run_async(self, text: str, core_handler: CoreHandler) -> Any:
        """
        Async execution — core_handler may be a coroutine function
        (e.g. an async LLM API call).
        """
        prepped = self._run_pre(text)
        try:
            if asyncio.iscoroutinefunction(core_handler):
                core_out = await core_handler(prepped)
            else:
                core_out = core_handler(prepped)
        except Exception as e:
            raise RuntimeError(f"Core handler failed: {e}") from e
        return self._run_post(core_out)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def describe(self) -> Dict[str, List[str]]:
        return {
            "pre":  [name for name, _ in self._pre],
            "post": [name for name, _ in self._post],
        }


# ---------------------------------------------------------------------------
# Pre-built steps for Apple ml-semantic-regex integration
# ---------------------------------------------------------------------------

def highlight_step(
    activation_pattern: str,
    flags: int = re.IGNORECASE,
) -> Tuple[str, PreProcessor]:
    """
    Returns an (name, fn) pre-processor that wraps activating tokens
    in << >> delimiters, matching Apple's explainer prompt format.
    """
    compiled = re.compile(activation_pattern, flags)
    def _fn(text: str) -> str:
        return compiled.sub(lambda m: f"<<{m.group(0)}>>", text)
    return ("highlight", _fn)


def truncate_step(max_chars: int = 256) -> Tuple[str, PreProcessor]:
    """Trim to a window around the first activation marker."""
    def _fn(text: str) -> str:
        marker = text.find("<<")
        if marker == -1:
            return text[:max_chars]
        start = max(0, marker - max_chars // 2)
        return text[start : start + max_chars]
    return ("truncate", _fn)


def parse_sr_step() -> Tuple[str, PostProcessor]:
    """Post-processor: raw model string → SemanticRegex dataclass."""
    return ("parse_sr", parse_sr)


def score_step(
    scorer: Callable[[SemanticRegex], Dict[str, float]]
) -> Tuple[str, PostProcessor]:
    """
    Post-processor: SemanticRegex → PipelineResult with scores attached.
    Pass your detection/fuzzing/clarity scorer here.
    """
    def _fn(sr: SemanticRegex) -> Dict[str, Any]:
        scores = scorer(sr)
        return {"sr": sr, "scores": scores}
    return ("score", _fn)


# ---------------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":

    # --- build pipeline ---
    pipeline = RegexPipeline()

    # pre: normalize whitespace, highlight activating tokens, truncate
    pipeline.add_pre("normalize", r"\s+", " ")
    pipeline.add_pre_fn(*highlight_step(r"\bfor\b"))
    pipeline.add_pre_fn(*truncate_step(max_chars=200))

    # post: parse SR out of model response, then score
    pipeline.add_post_fn(*parse_sr_step())
    pipeline.add_post_fn(*score_step(
        scorer=lambda sr: {"length": len(sr.sr), "has_field": "field" in sr.sr}
    ))

    print("Pipeline stages:", pipeline.describe())

    # --- sync run with a stub core handler ---
    def stub_explainer(text: str) -> str:
        return f"The token 'for' activates in coding contexts. SR: @{{:context coding:}}([:symbol for:])"

    result = pipeline.run(
        "p = 0 for q in qlist: pprev = p",
        stub_explainer,
    )
    print("SR:    ", result["sr"].sr)
    print("Scores:", result["scores"])

    # --- async run ---
    async def async_explainer(text: str) -> str:
        await asyncio.sleep(0)   # simulate async LLM call
        return f"Activates on 'for' in code. SR: @{{:context coding:}}([:symbol for:])"

    async def main():
        result = await pipeline.run_async(
            "ax = [fig.add_subplot(2,1,k+1) for k in range(2)]",
            async_explainer,
        )
        print("Async SR:    ", result["sr"].sr)
        print("Async Scores:", result["scores"])

    asyncio.run(main())
