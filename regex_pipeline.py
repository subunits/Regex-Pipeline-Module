import re
import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Tuple, Union


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

PreProcessor  = Callable[[str], str]
CoreHandler   = Callable[[str], Any]       # str → SR string (or awaitable)
PostProcessor = Callable[[Any], Any]       # chained: each receives previous output


@dataclass
class SemanticRegex:
    """Parsed output from the explainer model."""
    raw: str                # full model response
    sr: str                 # extracted SR expression
    explanation: str = ""   # prose before "SR:"


@dataclass
class PipelineResult:
    """Typed return value from run() / run_async()."""
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

    Pre-processors:  str  → str            (normalization, highlighting)
    Core handler:    str  → str            (explainer model call; sync or async)
    Post-processors: Any  → Any            (SR parsing, scoring, structured output)

    Post-processors chain — each receives the output of the previous one.
    The final post-processor must return a PipelineResult.

    Step ordering is enforced: highlight must precede truncate in pre,
    and parse_sr must precede score in post. Violations raise at registration.
    """

    # Names that must appear in this relative order within their stage
    _PRE_ORDER  = ["highlight", "truncate"]
    _POST_ORDER = ["parse_sr", "score"]

    def __init__(self):
        self._pre:  List[Tuple[str, PreProcessor]]  = []
        self._post: List[Tuple[str, PostProcessor]] = []

    # ------------------------------------------------------------------
    # Order enforcement
    # ------------------------------------------------------------------

    def _check_order(self, name: str, existing: List[Tuple[str, Any]], order: List[str]) -> None:
        """Raise if adding `name` would violate the required ordering."""
        if name not in order:
            return
        new_idx = order.index(name)
        for existing_name, _ in existing:
            if existing_name in order and order.index(existing_name) > new_idx:
                raise ValueError(
                    f"Step '{name}' must be added before '{existing_name}'. "
                    f"Required order: {order}"
                )

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
        self._check_order(name, self._pre, self._PRE_ORDER)
        compiled = re.compile(pattern, flags)       # compile once
        def _proc(text: str) -> str:
            return compiled.sub(repl, text)
        self._pre.append((name, _proc))
        return self

    def add_pre_fn(self, name: str, fn: PreProcessor) -> "RegexPipeline":
        """Add an arbitrary str→str function to the pre-processing stage."""
        self._check_order(name, self._pre, self._PRE_ORDER)
        self._pre.append((name, fn))
        return self

    def add_post_fn(self, name: str, fn: PostProcessor) -> "RegexPipeline":
        """
        Add a post-processing step. Receives whatever the previous step
        returned — not constrained to str→str.
        """
        self._check_order(name, self._post, self._POST_ORDER)
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

    def _run_post(self, value: Any) -> PipelineResult:
        for name, fn in self._post:
            try:
                value = fn(value)
            except Exception as e:
                raise RuntimeError(f"Post-processor '{name}' failed: {e}") from e
        if not isinstance(value, PipelineResult):
            raise TypeError(
                f"Final post-processor must return a PipelineResult, got {type(value).__name__}. "
                "Ensure score_step() is the last post-processor."
            )
        return value

    def run(self, text: str, core_handler: CoreHandler) -> PipelineResult:
        """Synchronous full-pipeline execution."""
        prepped = self._run_pre(text)
        try:
            core_out = core_handler(prepped)
        except Exception as e:
            raise RuntimeError(f"Core handler failed: {e}") from e
        return self._run_post(core_out)

    async def run_async(self, text: str, core_handler: CoreHandler) -> PipelineResult:
        """
        Async execution — core_handler may be a coroutine function
        (e.g. an async LLM API call). Pre/post stages remain synchronous.
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
    Pre-processor: wraps activating tokens in << >> delimiters,
    matching Apple's explainer prompt format.
    Must be added before truncate_step.
    """
    compiled = re.compile(activation_pattern, flags)
    def _fn(text: str) -> str:
        return compiled.sub(lambda m: f"<<{m.group(0)}>>", text)
    return ("highlight", _fn)


def truncate_step(max_chars: int = 256) -> Tuple[str, PreProcessor]:
    """
    Pre-processor: trims to a window centered on the first << >> marker.
    Must be added after highlight_step.
    """
    def _fn(text: str) -> str:
        marker = text.find("<<")
        if marker == -1:
            return text[:max_chars]
        start = max(0, marker - max_chars // 2)
        return text[start : start + max_chars]
    return ("truncate", _fn)


def parse_sr_step() -> Tuple[str, PostProcessor]:
    """Post-processor: raw model string → SemanticRegex. Must precede score_step."""
    return ("parse_sr", parse_sr)


def score_step(
    scorer: Callable[[SemanticRegex], Dict[str, float]],
    original: str = "",
    prepped: str  = "",
) -> Tuple[str, PostProcessor]:
    """
    Post-processor: SemanticRegex → PipelineResult.
    Must be the final post-processor — run() enforces this.
    Pass your detection/fuzzing/clarity scorer here.
    """
    def _fn(sr: Any) -> PipelineResult:
        if not isinstance(sr, SemanticRegex):
            raise TypeError(
                f"score_step received {type(sr).__name__}, expected SemanticRegex. "
                "Ensure parse_sr_step() runs before score_step()."
            )
        return PipelineResult(
            original=original,
            prepped=prepped,
            sr=sr,
            scores=scorer(sr),
        )
    return ("score", _fn)


# ---------------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":

    raw_text = "p = 0 for q in qlist: pprev = p"

    pipeline = RegexPipeline()

    # pre: normalize → highlight → truncate  (order enforced)
    pipeline.add_pre("normalize", r"\s+", " ")
    pipeline.add_pre_fn(*highlight_step(r"\bfor\b"))
    pipeline.add_pre_fn(*truncate_step(max_chars=200))

    # post: parse_sr → score  (order enforced)
    pipeline.add_post_fn(*parse_sr_step())
    pipeline.add_post_fn(*score_step(
        scorer=lambda sr: {"length": len(sr.sr), "has_field": "field" in sr.sr},
        original=raw_text,
    ))

    print("Pipeline stages:", pipeline.describe())

    # --- sync ---
    def stub_explainer(text: str) -> str:
        return "The token 'for' activates in coding contexts. SR: @{:context coding:}([:symbol for:])"

    result = pipeline.run(raw_text, stub_explainer)
    print("SR:      ", result.sr.sr)
    print("Scores:  ", result.scores)
    print("Original:", result.original)

    # --- async ---
    async def async_explainer(text: str) -> str:
        await asyncio.sleep(0)
        return "Activates on 'for' in code. SR: @{:context coding:}([:symbol for:])"

    async def main():
        result = await pipeline.run_async(
            "ax = [fig.add_subplot(2,1,k+1) for k in range(2)]",
            async_explainer,
        )
        print("Async SR:    ", result.sr.sr)
        print("Async Scores:", result.scores)

    asyncio.run(main())

    # --- order violation demo ---
    print("\n--- Order violation ---")
    try:
        bad = RegexPipeline()
        bad.add_pre_fn(*truncate_step())    # truncate before highlight → error
        bad.add_pre_fn(*highlight_step(r"\bfor\b"))
    except ValueError as e:
        print(f"Caught expected error: {e}")
