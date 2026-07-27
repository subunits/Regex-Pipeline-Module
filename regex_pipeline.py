import re
from typing import Callable, List, Tuple, Union

class RegexPipeline:
    """
    A robust pipeline module that executes ordered regular expression 
    transformations in separate pre-processing and post-processing stages.
    """
    def __init__(self):
        self.pre_processors: List[Tuple[str, Callable[[str], str]]] = []
        self.post_processors: List[Tuple[str, Callable[[str], str]]] = []

    def add_pre(self, name: str, pattern: str, repl: Union[str, Callable]) -> 'RegexPipeline':
        """
        Add a regular expression transformation step to the pre-processing phase.
        
        Args:
            name: A descriptive label for the processor step.
            pattern: The regular expression pattern to search for.
            repl: The replacement string or a function taking a match object.
        """
        def processor(text: str) -> str:
            return re.sub(pattern, repl, text)
        self.pre_processors.append((name, processor))
        return self

    def add_post(self, name: str, pattern: str, repl: Union[str, Callable]) -> 'RegexPipeline':
        """
        Add a regular expression transformation step to the post-processing phase.
        
        Args:
            name: A descriptive label for the processor step.
            pattern: The regular expression pattern to search for.
            repl: The replacement string or a function taking a match object.
        """
        def processor(text: str) -> str:
            return re.sub(pattern, repl, text)
        self.post_processors.append((name, processor))
        return self

    def process_pre(self, text: str) -> str:
        """Execute all pre-processing regex transformations in sequence."""
        for _, func in self.pre_processors:
            text = func(text)
        return text

    def process_post(self, text: str) -> str:
        """Execute all post-processing regex transformations in sequence."""
        for _, func in self.post_processors:
            text = func(text)
        return text

    def run(self, text: str, core_handler: Callable[[str], str]) -> str:
        """
        Executes the full lifecycle pipeline:
        1. Pre-processing steps
        2. Core handling / main logic execution
        3. Post-processing steps
        
        Args:
            text: The initial raw input string.
            core_handler: A callable function that takes the prepped string 
                          and returns the intermediate result.
        """
        prepped_text = self.process_pre(text)
        handled_text = core_handler(prepped_text)
        final_text = self.process_post(handled_text)
        return final_text
