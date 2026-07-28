import re
import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, Union


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

PreProcessor  = Callable[[str], str]
CoreHandler   = Callable[[str], Any]       # str → SR string (or awaitable)
PostProcessor = Callable[[Any], Any]       # chained: each receives previous output


@dataclass
class RunContext:
    """Runtime metadata that travels alongside the text through the pipeline."""
    original:   str
    prepped:    str            = ""
    feature_id: str            = ""
    layer:      int            = -1
    meta:       Dict[str, Any] = field(default_factory=dict)


@dataclass
class SemanticRegex:
    """Parsed output from the explainer model."""
    raw: str                # full model response
    sr: str                 # extracted SR expression
    explanation: str = ""   # prose before "SR:"


@dataclass
class PipelineResult:
    """Typed return value from run() / run_async()."""
    context: RunContext
    sr:      SemanticRegex
    scores:  Dict[str, Any] = field(default_factory=dict)

    @property
    def original(self) -> str:
        return self.context.original

    @property
    def prepped(self) -> str:
        return self.context.prepped


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

    A RunContext is created at run() time and stamped onto the final
    PipelineResult — so original, prepped, and any metadata always reflect
    the actual text that flowed through, regardless of how many times the
    pipeline is reused.

    Step ordering is enforced: highlight must precede truncate in pre,
    and parse_sr must precede score in post. Violations raise at registration.
    """

    _PRE_ORDER  = ["highlight", "truncate"]
    _POST_ORDER = ["parse_sr", "score"]

    def __init__(self):
        self._pre:  List[Tuple[str, PreProcessor]]  = []
        self._post: List[Tuple[str, PostProcessor]] = []

    # ------------------------------------------------------------------
    # Order enforcement
    # ------------------------------------------------------------------

    def _check_order(self, name: str, existing: List[Tuple[str, Any]], order: List[str]) -> None:
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
        compiled = re.compile(pattern, flags)
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
        """Add a post-processing step. Receives whatever the previous step returned."""
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

    def _run_post(self, value: Any, context: RunContext) -> PipelineResult:
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
        value.context = context
        return value

    def run(
        self,
        text: str,
        core_handler: CoreHandler,
        context: Optional[RunContext] = None,
    ) -> PipelineResult:
        """Synchronous full-pipeline execution."""
        prepped = self._run_pre(text)
        ctx = context or RunContext(original=text)
        ctx.original = text
        ctx.prepped  = prepped
        try:
            core_out = core_handler(prepped)
        except Exception as e:
            raise RuntimeError(f"Core handler failed: {e}") from e
        return self._run_post(core_out, ctx)

    async def run_async(
        self,
        text: str,
        core_handler: CoreHandler,
        context: Optional[RunContext] = None,
    ) -> PipelineResult:
        """Async execution — core_handler may be a coroutine function."""
        prepped = self._run_pre(text)
        ctx = context or RunContext(original=text)
        ctx.original = text
        ctx.prepped  = prepped
        try:
            if asyncio.iscoroutinefunction(core_handler):
                core_out = await core_handler(prepped)
            else:
                core_out = core_handler(prepped)
        except Exception as e:
            raise RuntimeError(f"Core handler failed: {e}") from e
        return self._run_post(core_out, ctx)

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
    """Pre-processor: wraps activating tokens in << >>. Must precede truncate_step."""
    compiled = re.compile(activation_pattern, flags)
    def _fn(text: str) -> str:
        return compiled.sub(lambda m: f"<<{m.group(0)}>>", text)
    return ("highlight", _fn)


def truncate_step(max_chars: int = 256) -> Tuple[str, PreProcessor]:
    """Pre-processor: trims to a window centered on the first << >> marker. Must follow highlight_step."""
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
) -> Tuple[str, PostProcessor]:
    """
    Post-processor: SemanticRegex → PipelineResult. Must be the final post-processor.
    original and prepped are injected by the pipeline at runtime via RunContext —
    no need to pass them here.
    """
    def _fn(sr: Any) -> PipelineResult:
        if not isinstance(sr, SemanticRegex):
            raise TypeError(
                f"score_step received {type(sr).__name__}, expected SemanticRegex. "
                "Ensure parse_sr_step() runs before score_step()."
            )
        return PipelineResult(
            context=RunContext(original=""),   # placeholder; _run_post stamps the real one
            sr=sr,
            scores=scorer(sr),
        )
    return ("score", _fn)


# ---------------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":

    pipeline = RegexPipeline()

    pipeline.add_pre("normalize", r"\s+", " ")
    pipeline.add_pre_fn(*highlight_step(r"\bfor\b"))
    pipeline.add_pre_fn(*truncate_step(max_chars=200))

    pipeline.add_post_fn(*parse_sr_step())
    pipeline.add_post_fn(*score_step(
        scorer=lambda sr: {"length": len(sr.sr), "has_field": "field" in sr.sr},
    ))

    print("Pipeline stages:", pipeline.describe())

    def stub_explainer(text: str) -> str:
        return "The token 'for' activates in coding contexts. SR: @{:context coding:}([:symbol for:])"

    for raw_text in [
        "p = 0 for q in qlist: pprev = p",
        "ax = [fig.add_subplot(2,1,k+1) for k in range(2)]",
    ]:
        ctx = RunContext(original=raw_text, feature_id="gpt2-res-25k-layer3-feat42", layer=3)
        result = pipeline.run(raw_text, stub_explainer, context=ctx)
        print(f"\nOriginal:   {result.original}")
        print(f"Prepped:    {result.prepped}")
        print(f"Feature:    {result.context.feature_id}  layer={result.context.layer}")
        print(f"SR:         {result.sr.sr}")
        print(f"Scores:     {result.scores}")

    async def async_explainer(text: str) -> str:
        await asyncio.sleep(0)
        return "Activates on 'for' in code. SR: @{:context coding:}([:symbol for:])"

    async def main():
        raw = "for lam, prob in suite.Items():"
        ctx = RunContext(original=raw, feature_id="gemma-2b-feat99", layer=12)
        result = await pipeline.run_async(raw, async_explainer, context=ctx)
        print(f"\nAsync original:   {result.original}")
        print(f"Async feature:    {result.context.feature_id}  layer={result.context.layer}")
        print(f"Async SR:         {result.sr.sr}")

    asyncio.run(main())

    print("\n--- Order violation ---")
    try:
        bad = RegexPipeline()
        bad.add_pre_fn(*truncate_step())
        bad.add_pre_fn(*highlight_step(r"\bfor\b"))
    except ValueError as e:
        print(f"Caught expected error: {e}")
