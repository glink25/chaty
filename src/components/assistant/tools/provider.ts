import type { History, Provider, ProviderRequestChunk } from "@/assistant";
import { withAbort } from "@/assistant/shared";

const PLACEHOLDER_ANSWER = "AI provider is not configured in this UI shell.";

function getLastUserMessage(history: History) {
    return history.findLast((message) => message.role === "user");
}

function getLastToolMessage(history: History) {
    return history.findLast((message) => message.role === "tool");
}

function buildToolSummary(history: History) {
    const toolMessage = getLastToolMessage(history);
    if (!toolMessage) {
        return PLACEHOLDER_ANSWER;
    }
    const { name, returns, errors } = toolMessage.formatted;
    if (errors !== undefined) {
        return `Tool ${name} failed:\n\n${JSON.stringify(errors, null, 2)}`;
    }
    return `Tool ${name} returned:\n\n${JSON.stringify(returns, null, 2)}`;
}

async function* createSingleChunk(
    answer: string,
): AsyncIterable<ProviderRequestChunk> {
    yield { answer };
}

export const ShellAIProvider: Provider = {
    request: ({ history }) => {
        const controller = new AbortController();
        const run = async () => {
            if (controller.signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }

            const lastMessage = history[history.length - 1];
            if (lastMessage?.role === "tool") {
                return createSingleChunk(buildToolSummary(history));
            }

            const raw = getLastUserMessage(history)?.raw ?? "";
            const answer = raw.includes("<tool>")
                ? raw
                : `<overview>AI Chat</overview>${PLACEHOLDER_ANSWER}`;
            return createSingleChunk(answer);
        };

        return withAbort(run(), () => controller.abort());
    },
};
