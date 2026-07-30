classDiagram
    direction LR
    class RunContext {
        +str original
        +str prepped
        +str feature_id
        +int layer
        +Dict meta
    }

    class SemanticRegex {
        +str raw
        +str sr
        +str explanation
    }

    class PipelineResult {
        +RunContext context
        +SemanticRegex sr
        +Dict scores
    }

    class RegexPipeline {
        -_pre: List
        -_post: List
        +add_pre()
        +add_pre_fn()
        +add_post_fn()
        +run()
        +run_async()
        +describe()
    }

    PipelineResult --> RunContext : contains
    PipelineResult --> SemanticRegex : contains
    RegexPipeline ..> RunContext : uses / stamps
    RegexPipeline ..> PipelineResult : returns
