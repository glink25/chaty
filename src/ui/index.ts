// chaty UI 库入口：导出可复用的对话 UI 组件与配套类型，供 web 项目直接 import，
// 无需经由 iframe，也无需复制一份 UI 实现。样式由 "@glink25/chaty/styles.css"
// 单独引入（不含 preflight，不污染宿主全局样式）。
import "./styles.css";

export {
    I18nProvider,
    type Locale,
    resolveLocale,
    useI18n,
} from "@/components/assistant/i18n";
export { default as MainAssistant } from "@/components/assistant/main";
export { MessageBubble } from "@/components/assistant/message";
export type {
    AIChatConfig,
    AIChatLocale,
    AIChatPresetPrompt,
    AIChatTheme,
    RuntimeConfig,
} from "@/components/assistant/runtime";
export { type Chat, useAssistantChatStore } from "@/components/assistant/state";
export {
    applyThemePreference,
    type ThemePreference,
} from "@/components/assistant/theme";
// 默认工具 / 技能 / 兜底 provider，方便消费方做最小可用接入。
export { AiChatConfig } from "@/components/assistant/tools";
