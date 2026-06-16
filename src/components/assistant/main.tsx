import {
    createContext,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Toaster, toast } from "sonner";
import {
    type AbortablePromise,
    type AssistantMessage,
    createSession,
    type History,
    type TurnResult,
} from "@/assistant";
import type { RuntimeConfig } from "@/chaty/host";
import { showFilePicker } from "@/components/file-picker";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { I18nProvider, useI18n } from "./i18n";
import { MessageBubble } from "./message";
import { type Chat, useAssistantChatStore } from "./state";
import { applyThemePreference } from "./theme";

type Input = { text: string; assets: File[] };

type AssistantContext = {
    input: Input;
    setInput: Dispatch<SetStateAction<Input>>;
    chats: Chat[];
    currentChatId: Chat["id"] | undefined;
    setCurrentChatId: Dispatch<SetStateAction<Chat["id"] | undefined>>;
    runtime: RuntimeConfig;
    selectedConfigId?: string;
    setSelectedConfigId: Dispatch<SetStateAction<string | undefined>>;
    canSend: boolean;
    isRunning: boolean;
    send: (nextInput?: Input) => void;
    stop: () => void;
};

const EMPTY_INPUT: Input = { text: "", assets: [] };
const AssistantContext = createContext<AssistantContext | null>(null);

const useAssistantContext = () => {
    const ctx = useContext(AssistantContext);
    if (!ctx) {
        throw new Error("AssistantContext init failed");
    }
    return ctx;
};

function createChatId() {
    return (
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    );
}

function normalizeHistory(history: History): History {
    return history.map((message, index) => ({
        ...message,
        id:
            message.id ??
            `${message.role}-${index}-${message.raw.slice(0, 48)}`,
    }));
}

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
    );
}

function Root({
    children,
    runtime,
}: {
    children?: ReactNode;
    runtime: RuntimeConfig;
}) {
    const [input, setInput] = useState<Input>(EMPTY_INPUT);
    const [currentChatId, setCurrentChatId] = useState<Chat["id"]>();
    const initialConfigId = useMemo(() => {
        const fallbackConfigId = runtime.configs[0]?.id;
        return runtime.configs.some(
            (config) => config.id === runtime.defaultConfigId,
        )
            ? runtime.defaultConfigId
            : fallbackConfigId;
    }, [runtime.defaultConfigId, runtime.configs]);
    const [selectedConfigId, setSelectedConfigId] = useState(initialConfigId);
    const [isRunning, setIsRunning] = useState(false);
    const activeRequestRef = useRef<AbortablePromise<
        AsyncIterable<TurnResult>
    > | null>(null);
    const runIdRef = useRef(0);
    const chats = useAssistantChatStore((s) => s.chats);
    const setChats = useAssistantChatStore((s) => s.setChats);

    useEffect(() => applyThemePreference(runtime.theme), [runtime.theme]);

    const currentChat = chats.find((chat) => chat.id === currentChatId);
    const canSend =
        !isRunning && (input.assets.length > 0 || input.text.trim().length > 0);

    const updateChat = useCallback(
        (chatId: string, history: History) => {
            setChats((prev) => {
                const existingIndex = prev.findIndex(
                    (chat) => chat.id === chatId,
                );
                const nextChat: Chat = {
                    id: chatId,
                    history: normalizeHistory(history),
                };
                if (existingIndex === -1) {
                    return [...prev, nextChat];
                }
                const nextChats = [...prev];
                nextChats[existingIndex] = nextChat;
                return nextChats;
            });
        },
        [setChats],
    );

    const send = useCallback(
        async (nextInput?: Input) => {
            if (activeRequestRef.current) {
                return;
            }

            const payload = nextInput ?? input;
            const text = payload.text.trim();
            if (payload.assets.length === 0 && text.length === 0) {
                return;
            }

            const runId = runIdRef.current + 1;
            runIdRef.current = runId;
            const chatId = currentChat?.id ?? createChatId();
            const session = createSession({
                history: currentChat?.history ?? [],
                ...runtime,
                configId: selectedConfigId,
            });
            const request = session({
                message: text,
                assets: payload.assets,
            });

            activeRequestRef.current = request;
            setIsRunning(true);
            setInput(EMPTY_INPUT);
            setCurrentChatId(chatId);

            try {
                const stream = await request;
                for await (const chunk of stream) {
                    updateChat(chatId, chunk.history);
                }
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
                const message =
                    error instanceof Error ? error.message : String(error);
                toast.error(message);
            } finally {
                if (runIdRef.current === runId) {
                    activeRequestRef.current = null;
                    setIsRunning(false);
                }
            }
        },
        [input, currentChat, runtime, selectedConfigId, updateChat],
    );

    const stop = useCallback(() => {
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        setIsRunning(false);
    }, []);

    const ctx = useMemo(
        () => ({
            input,
            setInput,
            chats,
            currentChatId,
            setCurrentChatId,
            runtime,
            selectedConfigId,
            setSelectedConfigId,
            canSend,
            isRunning,
            send,
            stop,
        }),
        [
            input,
            chats,
            currentChatId,
            runtime,
            selectedConfigId,
            canSend,
            isRunning,
            send,
            stop,
        ],
    );

    return (
        <I18nProvider locale={runtime.locale}>
            <AssistantContext.Provider value={ctx}>
                <div className="h-full w-full bg-background text-foreground">
                    {children}
                </div>
                <Toaster richColors position="top-center" />
            </AssistantContext.Provider>
        </I18nProvider>
    );
}

function ModelSwitcher() {
    const { runtime, selectedConfigId, setSelectedConfigId } =
        useAssistantContext();
    const { t } = useI18n();
    const [open, setOpen] = useState(false);

    if (runtime.configs.length === 0) {
        return null;
    }

    const currentConfig = runtime.configs.find(
        (config) => config.id === selectedConfigId,
    );
    const label = currentConfig?.name ?? t("switchModel");

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={label}
                    className="inline-flex h-8 max-w-[160px] cursor-pointer items-center gap-1 rounded-full px-2 text-xs text-foreground/70 hover:bg-muted hover:text-foreground"
                >
                    <span className="truncate">{label}</span>
                    <i className="icon-[mdi--unfold-more-horizontal] size-3.5 flex-shrink-0 opacity-70"></i>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="start" side="top">
                <div className="max-h-72 overflow-y-auto">
                    {runtime.configs.map((config) => (
                        <button
                            type="button"
                            key={config.id}
                            onClick={() => {
                                setSelectedConfigId(config.id);
                                setOpen(false);
                            }}
                            className={`group flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent ${
                                config.id === selectedConfigId
                                    ? "bg-accent"
                                    : ""
                            }`}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {config.name}
                            </span>
                            {config.id === selectedConfigId && (
                                <i className="icon-[mdi--check] size-4"></i>
                            )}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function Actions() {
    const { chats, currentChatId, setCurrentChatId } = useAssistantContext();
    const { t } = useI18n();
    const setChats = useAssistantChatStore((s) => s.setChats);
    const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);

    return (
        <div className="flex items-center">
            <Button variant="ghost" onClick={() => setCurrentChatId(undefined)}>
                <i className="icon-[mdi--comment-add-outline] size-5"></i>
            </Button>
            <Popover open={isChatMenuOpen} onOpenChange={setIsChatMenuOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        className="border-none shadow-none !text-foreground px-2"
                    >
                        <i className="icon-[mdi--menu] size-5"></i>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1" align="end">
                    <div className="max-h-72 overflow-y-auto">
                        {chats.length === 0 && (
                            <div className="px-2 py-3 text-sm opacity-70 text-center">
                                {t("noChats")}
                            </div>
                        )}
                        {chats.map((chat) => {
                            const title =
                                chat.history.find(
                                    (message): message is AssistantMessage =>
                                        message.role === "assistant" &&
                                        Boolean(message.formatted.overview),
                                )?.formatted.overview ?? t("newChat");
                            return (
                                <div
                                    key={chat.id}
                                    className={`group flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent ${
                                        currentChatId === chat.id
                                            ? "bg-accent"
                                            : ""
                                    }`}
                                >
                                    {currentChatId === chat.id && (
                                        <i className="ml-auto icon-[mdi--check]"></i>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCurrentChatId(chat.id);
                                            setIsChatMenuOpen(false);
                                        }}
                                        className="min-w-0 flex-1 flex items-center gap-2 text-left"
                                    >
                                        <span className="truncate">
                                            {title}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setChats((prev) =>
                                                prev.filter(
                                                    (item) =>
                                                        item.id !== chat.id,
                                                ),
                                            );
                                            if (currentChatId === chat.id) {
                                                setCurrentChatId(undefined);
                                            }
                                        }}
                                        className="rounded-sm p-1 opacity-60 hover:opacity-100 hover:bg-accent text-foreground/80 flex justify-center items-center"
                                        aria-label={t("deleteChat")}
                                    >
                                        <i className="icon-[mdi--close] size-4"></i>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

function Content() {
    const {
        input,
        setInput,
        send,
        stop,
        canSend,
        isRunning,
        chats,
        currentChatId,
        runtime,
    } = useAssistantContext();
    const { t } = useI18n();
    const currentChat = chats.find((chat) => chat.id === currentChatId);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const sendRef = useRef(send);
    sendRef.current = send;

    useEffect(() => {
        if (currentChat?.history.length && currentChatId) {
            messagesContainerRef.current?.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [currentChat?.history.length, currentChatId]);

    return (
        <div className="w-full h-full flex flex-col overflow-hidden relative">
            <div className="flex justify-center items-center py-2 h-12">
                <div>{runtime.title ?? t("appTitle")}</div>
                <div className="absolute right-2">
                    <Actions />
                </div>
            </div>
            <div
                ref={messagesContainerRef}
                className="w-full flex-1 flex flex-col gap-4 overflow-y-auto px-2 py-2 pb-[170px] text-sm"
            >
                {currentChat ? (
                    currentChat.history
                        .filter((message) => message.role !== "system")
                        .map((message) => (
                            <MessageBubble key={message.id} message={message} />
                        ))
                ) : (
                    <div className="w-full h-full flex flex-col gap-4 justify-center items-center">
                        <i className="icon-[mdi--shimmer-outline] size-12 text-lg bg-gradient-to-tr from-cyan-400 via-blue-500 to-purple-600"></i>
                        {runtime.emptyStateSlogan ?? t("emptyState")}
                    </div>
                )}
            </div>
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 bottom-[-10px] h-[150px] bg-gradient-to-b from-transparent via-background/70 to-background/95 backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,transparent,black_40%)]"
            />
            <div className="w-full absolute left-0 bottom-0 px-2 py-4 flex flex-col gap-2">
                {runtime.presetPrompts?.length ? (
                    <div className="w-full flex overflow-x-auto scrollbar-hidden gap-2">
                        {runtime.presetPrompts.map((presetPrompt) => (
                            <button
                                key={presetPrompt.id}
                                type="button"
                                onClick={async () => {
                                    if (!isRunning) {
                                        const nextInput = {
                                            ...input,
                                            text: presetPrompt.prompt,
                                        };
                                        setInput((value) => ({
                                            ...value,
                                            text: presetPrompt.prompt,
                                        }));
                                        sendRef.current(nextInput);
                                    }
                                }}
                                className="rounded-full border shadow py-1 px-2 text-xs hover:bg-muted cursor-pointer bg-background flex-shrink-0"
                            >
                                {presetPrompt.label}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="rounded-2xl w-full border shadow p-1 flex flex-col gap-2 bg-background">
                    {input.assets.length > 0 && (
                        <div className="flex gap-2 px-2 overflow-x-auto scrollbar-hidden">
                            {input.assets.map((file, index) => (
                                <div
                                    key={`${file.name}-${index}`}
                                    className="flex-shrink-0 bg-muted rounded p-2 text-xs flex items-center gap-2"
                                >
                                    <i className="icon-[mdi--file-outline] size-4"></i>
                                    <span className="max-w-24 truncate">
                                        {file.name}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setInput((value) => ({
                                                ...value,
                                                assets: value.assets.filter(
                                                    (_, itemIndex) =>
                                                        itemIndex !== index,
                                                ),
                                            }))
                                        }
                                        className="hover:bg-accent rounded p-0.5"
                                    >
                                        <i className="icon-[mdi--close] size-3"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <textarea
                        value={input.text}
                        onChange={(event) => {
                            setInput((value) => ({
                                ...value,
                                text: event.target.value,
                            }));
                        }}
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) {
                                return;
                            }
                            if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !event.metaKey &&
                                !event.ctrlKey
                            ) {
                                event.preventDefault();
                                if (canSend) {
                                    send();
                                }
                            }
                        }}
                        className="w-full h-10 p-2 resize-none !outline-none text-sm bg-transparent"
                    />
                    <div className="flex justify-between items-center">
                        <div className="flex min-w-0 items-center gap-1">
                            <Button
                                variant="ghost"
                                className="rounded-full p-0 w-8 h-8"
                                onClick={async () => {
                                    if (input.assets.length >= 3) {
                                        toast.error(t("uploadLimit"));
                                        return;
                                    }
                                    const files = await showFilePicker({
                                        multiple: true,
                                    });
                                    const remaining = 3 - input.assets.length;
                                    setInput((value) => ({
                                        ...value,
                                        assets: [
                                            ...value.assets,
                                            ...files.slice(0, remaining),
                                        ],
                                    }));
                                }}
                            >
                                <i className="icon-[mdi--plus] size-5"></i>
                            </Button>
                            <ModelSwitcher />
                        </div>
                        <Button
                            variant="ghost"
                            className="rounded-full p-0 w-8 h-8 bg-foreground/10 hover:bg-foreground/40"
                            disabled={!isRunning && !canSend}
                            onClick={isRunning ? stop : () => send()}
                            aria-label={
                                isRunning ? t("stopResponse") : t("sendMessage")
                            }
                        >
                            <i
                                className={`size-4 ${
                                    isRunning
                                        ? "icon-[mdi--stop]"
                                        : "icon-[mdi--send]"
                                }`}
                            ></i>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const MainAssistant = {
    Root,
    Content,
    Actions,
};

export default MainAssistant;
