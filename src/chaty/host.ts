import { z } from "zod";
import type {
    Provider,
    ProviderRequestChunk,
    SkillInput,
    Tool,
} from "@/assistant";
import { withAbort } from "@/assistant/shared";
import { getAndroidNativeHost, getIosNativeHost } from "./native-host";
import type {
    AIChatConfig,
    AIChatInitPayload,
    AIChatPresetPrompt,
    AIChatSkillDefinition,
    HostBridge,
    HostRequestHandle,
} from "./types";

export type RuntimeConfig = {
    provider: Provider;
    tools: Tool[];
    skills: SkillInput[];
    systemPrompt?: string;
    configs: AIChatConfig[];
    defaultConfigId?: string;
    presetPrompts?: AIChatPresetPrompt[];
    locale?: AIChatInitPayload["locale"];
    theme?: AIChatInitPayload["theme"];
    emptyStateSlogan?: string;
};

function createRequestId() {
    return (
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    );
}

function getSameOriginParentHost(): HostBridge | undefined {
    if (window.parent === window) {
        return undefined;
    }
    try {
        return window.parent.AIChatHost;
    } catch {
        return undefined;
    }
}

export function getHostBridge(): HostBridge | undefined {
    return (
        window.AIChatHost ??
        getSameOriginParentHost() ??
        getAndroidNativeHost() ??
        getIosNativeHost()
    );
}

function createHostProvider(host: HostBridge): Provider {
    return {
        request: ({ history, configId }) => {
            let handle: HostRequestHandle | undefined;
            let cancelled = false;
            let done = false;
            const queue: ProviderRequestChunk[] = [];
            let wake: (() => void) | undefined;
            let failure: unknown;

            const notify = () => {
                wake?.();
                wake = undefined;
            };

            const run = async function* () {
                const requestId = createRequestId();
                Promise.resolve(
                    host.requestAI({
                        requestId,
                        configId,
                        history,
                        onChunk: (chunk) => {
                            queue.push(chunk);
                            notify();
                        },
                        onDone: () => {
                            done = true;
                            notify();
                        },
                        onError: (error) => {
                            failure = error;
                            done = true;
                            notify();
                        },
                    }),
                )
                    .then((nextHandle) => {
                        handle = nextHandle;
                        if (cancelled) {
                            handle.cancel();
                        }
                    })
                    .catch((error) => {
                        failure = error;
                        done = true;
                        notify();
                    });

                while (!done || queue.length > 0) {
                    if (queue.length > 0) {
                        yield queue.shift()!;
                        continue;
                    }
                    await new Promise<void>((resolve) => {
                        wake = resolve;
                    });
                }

                if (failure) {
                    throw failure;
                }
            };

            return withAbort(Promise.resolve(run()), () => {
                cancelled = true;
                done = true;
                handle?.cancel();
                notify();
            });
        },
    };
}

function createHostTool(
    host: HostBridge,
    tool: AIChatInitPayload["tools"][number],
): Tool {
    const argDescription = tool.argJsonSchema
        ? JSON.stringify(tool.argJsonSchema)
        : "No parameters";
    return {
        name: tool.name,
        describe: tool.describe,
        argSchema: z.unknown().describe(argDescription),
        returnSchema: z
            .unknown()
            .describe(JSON.stringify(tool.returnJsonSchema)),
        handler: (params, ctx) =>
            host.callTool({
                callId: createRequestId(),
                name: tool.name,
                params,
                history: ctx.history,
            }),
    };
}

function createHostSkill(
    host: HostBridge,
    skill: AIChatSkillDefinition,
): SkillInput {
    if (typeof skill.content === "string") {
        return skill;
    }
    return {
        ...skill,
        loader: async () => {
            const loaded = await host.loadSkill?.({ id: skill.id });
            return loaded?.content ?? "";
        },
    };
}

export async function loadHostRuntimeConfig(
    fallback: RuntimeConfig,
): Promise<RuntimeConfig> {
    const host = getHostBridge();
    if (!host) {
        return {
            ...fallback,
            presetPrompts: fallback.presetPrompts ?? [],
            theme: fallback.theme ?? "system",
        };
    }

    const init = (await host.getInit?.()) ?? {
        configs: [],
        systemPrompt: "",
        presetPrompts: [],
        tools: [],
        skills: [],
        theme: "system" as const,
    };
    const defaultConfigId = init.configs.some(
        (config) => config.id === init.defaultConfigId,
    )
        ? init.defaultConfigId
        : init.configs[0]?.id;

    return {
        provider: createHostProvider(host),
        tools: [
            ...fallback.tools,
            ...init.tools.map((tool) => createHostTool(host, tool)),
        ],
        skills: [
            ...fallback.skills,
            ...init.skills.map((skill) => createHostSkill(host, skill)),
        ],
        systemPrompt: init.systemPrompt,
        configs: init.configs,
        defaultConfigId,
        presetPrompts: init.presetPrompts,
        locale: init.locale,
        theme: init.theme ?? "system",
        emptyStateSlogan: init.emptyStateSlogan,
    };
}
