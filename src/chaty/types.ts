import type { History, ProviderRequestChunk } from "@/assistant";

export type AIChatConfig = {
    id: string;
    name: string;
};

export type AIChatPresetPrompt = {
    id: string;
    label: string;
    prompt: string;
};

export type AIChatToolDefinition = {
    name: string;
    describe: string;
    argJsonSchema?: Record<string, unknown>;
    returnJsonSchema: Record<string, unknown>;
};

export type AIChatSkillDefinition = {
    id: string;
    name: string;
    description: string;
    content?: string;
};

export type AIChatInitPayload = {
    configs: AIChatConfig[];
    defaultConfigId?: string;
    systemPrompt: string;
    presetPrompts: AIChatPresetPrompt[];
    tools: AIChatToolDefinition[];
    skills: AIChatSkillDefinition[];
    locale?: "zh" | "en";
    theme?: "light" | "dark" | "system";
    /** 首页空界面时的标语。不传时使用 chaty 内置的默认标语。 */
    emptyStateSlogan?: string;
};

export type HostRequestHandle = {
    cancel: () => void;
};

export type HostBridge = {
    getInit?: () => AIChatInitPayload | Promise<AIChatInitPayload>;
    requestAI: (args: {
        requestId: string;
        configId?: string;
        history: History;
        onChunk: (chunk: ProviderRequestChunk) => void;
        onDone: () => void;
        onError: (error: unknown) => void;
    }) => HostRequestHandle | Promise<HostRequestHandle>;
    callTool: (args: {
        callId: string;
        name: string;
        params: unknown;
        history: History;
    }) => Promise<unknown>;
    loadSkill?: (args: { id: string }) => Promise<AIChatSkillDefinition>;
};

/**
 * 统一的 native (Android / iOS) bridge 协议。
 *
 * 为了兼容 WKWebView 的单向异步 `postMessage`，Android 和 iOS 都统一走
 * async callback 协议。即使 Android 能同步返回字符串，也只把同步能力作为内部
 * 实现细节，不暴露给上层。
 */
export type NativeBridgeMessage =
    | { id: string; type: "getInit" }
    | {
          id: string;
          type: "requestAI";
          payload: {
              requestId: string;
              configId?: string;
              history: History;
          };
      }
    | {
          id: string;
          type: "cancelRequest";
          payload: { requestId: string };
      }
    | {
          id: string;
          type: "callTool";
          payload: {
              callId: string;
              name: string;
              params: unknown;
              history: History;
          };
      };

/**
 * 注册在 `window.__AIChatNativeCallbacks` 上、由 native 侧通过
 * `evaluateJavaScript` / `evaluateJavascript` 回调的处理函数集合。
 */
export type NativeCallback = {
    resolve?: (value: unknown) => void;
    reject?: (error: unknown) => void;
    onChunk?: (chunk: ProviderRequestChunk) => void;
    onDone?: () => void;
    onError?: (error: unknown) => void;
};

/** Android WebView 通过 `addJavascriptInterface` 暴露的 bridge。 */
export type AndroidNativeBridge = {
    postMessage(messageJson: string): void;
};

/** iOS WKWebView 通过 `messageHandlers` 暴露的 bridge。 */
export type IosNativeBridge = {
    postMessage(message: NativeBridgeMessage): void;
};

declare global {
    interface Window {
        AIChatHost?: HostBridge;
        __AIChatNativeCallbacks?: Record<string, NativeCallback>;
        CentAiChatNative?: AndroidNativeBridge;
        webkit?: {
            messageHandlers?: {
                CentAiChatNative?: IosNativeBridge;
            };
        };
    }
}
