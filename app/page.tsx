"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AddProductFlow } from "@/components/AddProductFlow";
import { Composer } from "@/components/Composer";
import { AskComposer } from "@/components/AskComposer";
import { Icon } from "@/components/Icon";
import { PasswordDialog } from "@/components/PasswordDialog";
import { MerchantPortal } from "@/components/MerchantPortal";
import { aboutText, askText, editText, localeNames, Locale } from "@/lib/portal-i18n";
import { mapKnowledgeRecords, type KnowledgeEntry, type KnowledgeRecord } from "@/lib/portal-knowledge";
import { editActions, EditAction, products } from "@/lib/mock-data";
import {
  generateSku,
  Message,
  MockImage,
  ProductDraft,
  readImageFile,
} from "@/lib/interactions";
import { parseAssistantMarkdown } from "@/lib/ask/format";
import { shouldAutoScrollToLatest } from "@/lib/ask/scroll";
import { readAskEventStream } from "@/lib/ask/client-stream";

type Mode = "ASK" | "EDIT";
type WorkflowStep = "form" | "review" | "done";

const emptyProduct: ProductDraft = {
  name: "",
  category: "",
  pack: "",
  price: "",
  description: "",
  availability: "Available",
};

const initialWorkflowFields = {
  product: products[0].name,
  pack: "",
  price: "",
  field: "Product name",
  value: "",
  availability: "Available",
};

function renderInlineMarkdown(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
      : part,
  );
}

function FormattedMessage({ content }: { content: string }) {
  const blocks = parseAssistantMarkdown(content);
  return (
    <div className="formatted-message">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h3 key={index}>{renderInlineMarkdown(block.text, `h-${index}`)}</h3>;
        if (block.type === "paragraph") return <p key={index}>{renderInlineMarkdown(block.text, `p-${index}`)}</p>;
        if (block.type === "list") {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `l-${index}-${itemIndex}`)}</li>)}</ul>;
        }
        return (
          <div className="formatted-table-scroll" key={index} role="region" aria-label="Assistant response table" tabIndex={0}>
            <table>
              <thead><tr>{block.rows[0].map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdown(cell, `th-${index}-${cellIndex}`)}</th>)}</tr></thead>
              <tbody>{block.rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function MessageThread({
  messages,
  onCopy,
  copiedMessage,
  canCopy,
  copyLabels,
  stoppedMessageIds,
  stoppedLabel,
}: {
  messages: Message[];
  onCopy: (message: Message) => void;
  copiedMessage: string | null;
  canCopy: boolean;
  stoppedMessageIds: ReadonlySet<string>;
  stoppedLabel: string;
  copyLabels: {
    copyResponse: string;
    responseCopied: string;
    copy: string;
    copied: string;
  };
}) {
  return (
    <div className="message-thread">
      {messages.map((message) => (
        <article className={`message-row ${message.role}`} key={message.id}>
          <div className={message.role === "user" ? "user-bubble" : "assistant-message"}>
            {message.role === "assistant" ? (
              message.content ? <FormattedMessage content={message.content} /> : null
            ) : message.content}
          </div>
          {message.role === "assistant" && stoppedMessageIds.has(message.id) && (
            <small className="answer-stopped">{stoppedLabel}</small>
          )}
          {message.role === "assistant" && message.content && canCopy && (
            <button
              aria-label={copiedMessage === message.id ? copyLabels.responseCopied : copyLabels.copyResponse}
              className="copy-button"
              onClick={() => onCopy(message)}
              title={copiedMessage === message.id ? copyLabels.copied : copyLabels.copyResponse}
              type="button"
            >
              <Icon name={copiedMessage === message.id ? "check" : "copy"} size={17} />
              <span>{copiedMessage === message.id ? copyLabels.copied : copyLabels.copy}</span>
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function WorkflowDialog({
  title,
  children,
  onClose,
  eyebrow,
  closeLabel,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  eyebrow: string;
  closeLabel: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section aria-labelledby="workflow-dialog-title" aria-modal="true" className="dialog compact-dialog" role="dialog">
        <button aria-label={closeLabel} className="icon-button dialog-close" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="workflow-dialog-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("hi");
  const [mode, setMode] = useState<Mode>("ASK");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [activeAction, setActiveAction] = useState<EditAction | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("form");
  const [askMessages, setAskMessages] = useState<Message[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [editMessages, setEditMessages] = useState<Message[]>([]);
  const [askDraft, setAskDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [stoppedMessageIds, setStoppedMessageIds] = useState<Set<string>>(() => new Set());
  const [conversationLoading] = useState(false);
  const [askError, setAskError] = useState("");
  const [composerImages, setComposerImages] = useState<MockImage[]>([]);
  const [productImages, setProductImages] = useState<MockImage[]>([]);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProduct);
  const [generatedSku, setGeneratedSku] = useState("");
  const [workflowFields, setWorkflowFields] = useState(initialWorkflowFields);
  const [productImageError, setProductImageError] = useState("");
  const [composerImageError, setComposerImageError] = useState("");
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [utilityDialog, setUtilityDialog] = useState<"info" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionRestored, setSessionRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const askInFlight = useRef(false);
  const askRequest = useRef<AbortController | null>(null);
  const activeAssistantRef = useRef<{ id: string; content: string } | null>(null);
  const nearBottom = useRef(true);
  const justSubmittedQuestion = useRef(false);

  const askLabels = askText[locale];
  const aboutLabels = aboutText[locale];
  const editLabels = editText[locale];
  const activeMessages = mode === "ASK" ? askMessages : editMessages;
  const draft = mode === "ASK" ? askDraft : editDraft;
  const thinkingMessage = askLabels.thinking[Math.floor(askMessages.length / 2) % askLabels.thinking.length];
  const visibleSearchResults = (mode === "ASK" ? askMessages : editMessages).filter((message) =>
    searchTerm.trim() && message.content.toLowerCase().includes(searchTerm.trim().toLowerCase()),
  );

  const refreshKnowledge = useCallback(async (): Promise<boolean> => {
    setKnowledgeLoading(true);
    setKnowledgeError("");
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store", credentials: "include" });
      const result = await response.json() as { entries?: KnowledgeRecord[]; error?: string };
      if (!response.ok || !Array.isArray(result.entries)) {
        throw new Error(result.error || "Knowledge Base entries could not be loaded.");
      }
      setKnowledge(mapKnowledgeRecords(result.entries));
      return true;
    } catch (error) {
      console.error("[knowledge] client_load_failed", error instanceof Error ? error.message : "unknown error");
      setKnowledgeError(locale === "hi"
        ? "ज्ञानकोष लोड नहीं हो सका। कृपया फिर कोशिश करें।"
        : "Knowledge Base entries could not be loaded. Please try again.");
      return false;
    } finally {
      setKnowledgeLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refreshKnowledge();
  }, [refreshKnowledge]);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const response = await fetch("/api/merchant/session", { cache: "no-store" });
        const result = await response.json() as { authenticated?: boolean };
        if (cancelled) return;
        if (response.ok && result.authenticated) {
          setEditUnlocked(true);
          setMode("EDIT");
        }
      } catch {
        // Session restore is best-effort; unauthenticated users stay in ASK mode.
      } finally {
        if (!cancelled) setSessionRestored(true);
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement && shouldAutoScrollToLatest(nearBottom.current, justSubmittedQuestion.current)) {
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "smooth" });
      justSubmittedQuestion.current = false;
    }
  }, [activeMessages, thinking, streamingAnswer, voiceTranscribing, mode, activeAction, workflowStep]);

  function addMockImages(
    files: FileList | null,
    current: MockImage[],
    setImages: (images: MockImage[]) => void,
    setError: (message: string) => void,
  ) {
    if (!files?.length) return;
    const remaining = Math.max(0, 2 - current.length);
    if (remaining === 0) {
      setError(editLabels.imageLimit);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    void Promise.all(selected.map(readImageFile))
      .then((images) => {
        setImages([...current, ...images].slice(0, 2));
        setError("");
      })
      .catch((error: unknown) => {
        console.error("[images] preview_failed", error);
        setError(editLabels.imageError);
      });
  }

  async function submitAsk(content: string) {
    const question = content.trim();
    if (!question || askInFlight.current || conversationLoading) return;
    askInFlight.current = true;
    justSubmittedQuestion.current = true;
    setAskError("");
    setVoiceTranscribing(false);
    setStreamingAnswer(false);
    const optimisticId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    activeAssistantRef.current = { id: assistantId, content: "" };
    setAskMessages((current) => [...current, { id: optimisticId, role: "user", content: question }]);
    setThinking(true);
    setAskDraft("");
    const controller = new AbortController();
    askRequest.current = controller;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          history: askMessages
            .filter((message) => message.content.trim())
            .slice(-10)
            .map(({ role, content }) => ({ role, content })),
          knowledge: knowledge
            .filter((entry) => !entry.archived)
            .map(({ id, content }) => ({ id, content })),
        }),
      });
      if (!response.ok) {
        await response.json().catch(() => ({}));
        setAskMessages((current) => {
          const withoutOptimistic = current.filter((message) => message.id !== optimisticId);
          return withoutOptimistic;
        });
        setAskDraft(question);
        setAskError(askLabels.sendError);
        return;
      }

      let completed = false;
      await readAskEventStream(response, (event) => {
        if (event.type === "token") {
          const active = activeAssistantRef.current;
          if (!active) return;
          active.content += event.token;
          setStreamingAnswer(true);
          setAskMessages((current) => {
            const existing = current.findIndex((message) => message.id === active.id);
            if (existing < 0) return [...current, { id: active.id, role: "assistant", content: active.content }];
            return current.map((message) => message.id === active.id ? { ...message, content: active.content } : message);
          });
        } else if (event.type === "reset") {
          const active = activeAssistantRef.current;
          if (!active) return;
          active.content = "";
          setStreamingAnswer(false);
          setAskMessages((current) => current.filter((message) => message.id !== active.id));
        } else if (event.type === "answer") {
          const active = activeAssistantRef.current;
          if (!active) return;
          active.content = event.answer;
          setAskMessages((current) => [...current, { id: active.id, role: "assistant", content: event.answer }]);
        } else if (event.type === "done") {
          completed = true;
        } else {
          setAskError(askLabels.connectionError);
        }
      });
      if (!completed) setAskError(askLabels.connectionError);
    } catch {
      if (controller.signal.aborted) return;
      if (!activeAssistantRef.current?.content) {
        setAskMessages((current) => current.filter((message) => message.id !== optimisticId));
        setAskDraft(question);
      }
      setAskError(askLabels.connectionError);
    } finally {
      if (askRequest.current === controller) {
        askRequest.current = null;
        askInFlight.current = false;
        setThinking(false);
        setStreamingAnswer(false);
        activeAssistantRef.current = null;
      }
    }
  }

  function stopAskResponse() {
    const controller = askRequest.current;
    if (!controller) return;
    const active = activeAssistantRef.current;
    if (active) {
      setAskMessages((current) => current.some((message) => message.id === active.id)
        ? current
        : [...current, { id: active.id, role: "assistant", content: active.content }]);
      setStoppedMessageIds((current) => new Set(current).add(active.id));
    }
    controller.abort();
    askRequest.current = null;
    askInFlight.current = false;
    activeAssistantRef.current = null;
    setThinking(false);
    setStreamingAnswer(false);
  }

  function submitEdit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = editDraft.trim();
    if (!content && composerImages.length === 0) return;
    const attachmentNote = composerImages.length
      ? editLabels.sharedImages(composerImages.length, composerImages.map((image) => image.name).join(", "))
      : "";
    const userContent = [content, attachmentNote].filter(Boolean).join("\n");
    setEditMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: userContent },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: activeAction ? editLabels.noted : editLabels.chooseAction,
      },
    ]);
    setEditDraft("");
    setComposerImages([]);
    setComposerImageError("");
  }

  function switchToAsk() {
    askRequest.current?.abort();
    askRequest.current = null;
    askInFlight.current = false;
    setThinking(false);
    setAskMessages([]);
    setAskDraft("");
    setAskError("");
    setMode("ASK");
    setEditUnlocked(false);
    setActiveAction(null);
    setWorkflowStep("form");
    setComposerImages([]);
  }

  function openEdit() {
    if (editUnlocked) {
      askRequest.current?.abort();
      askRequest.current = null;
      askInFlight.current = false;
      setThinking(false);
      setAskMessages([]);
      setAskDraft("");
      setMode("EDIT");
    } else {
      setPasswordOpen(true);
    }
  }

  function logout() {
    askRequest.current?.abort();
    askRequest.current = null;
    askInFlight.current = false;
    setThinking(false);
    setAskMessages([]);
    setAskDraft("");
    setAskError("");
    setMode("ASK");
    setEditUnlocked(false);
    setActiveAction(null);
    setWorkflowStep("form");
    setComposerImages([]);
    void fetch("/api/merchant/logout", { method: "POST" });
  }

  async function verifyMerchantPassword(password: string): Promise<boolean> {
    try {
      const response = await fetch("/api/merchant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) return false;
      setEditUnlocked(true);
      askRequest.current?.abort();
      askRequest.current = null;
      askInFlight.current = false;
      setThinking(false);
      setAskMessages([]);
      setAskDraft("");
      setMode("EDIT");
      setPasswordOpen(false);
      return true;
    } catch {
      return false;
    }
  }

  function chooseAction(action: EditAction) {
    setActiveAction(action);
    setWorkflowStep("form");
    setProductDraft(emptyProduct);
    setProductImages([]);
    setGeneratedSku("");
    setProductImageError("");
    setWorkflowFields(initialWorkflowFields);
    setEditMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: editLabels.actionLabels[action] },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: action === "Add product"
          ? editLabels.addProductIntro
          : editLabels.actionIntro(editLabels.actionLabels[action]),
      },
    ]);
  }

  function reviewNewProduct() {
    if (!productDraft.name.trim() || !productDraft.category || !productDraft.pack.trim() || !productDraft.price) return;
    setGeneratedSku(generateSku(productDraft.name));
    setWorkflowStep("review");
  }

  function confirmNewProduct() {
    setPublishConfirm(false);
    setWorkflowStep("done");
    setEditMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "assistant", content: `**${productDraft.name}** ${editLabels.published}` },
    ]);
  }

  function reviewWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorkflowStep("review");
  }

  function confirmWorkflow() {
    setWorkflowStep("done");
    setEditMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: editLabels.workflowDone,
      },
    ]);
  }

  async function copyResponse(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessage(message.id);
      setCopyError("");
      window.setTimeout(() => setCopiedMessage((current) => current === message.id ? null : current), 1600);
    } catch {
      setCopyError(askLabels.copyUnavailable);
    }
  }

  function renderWorkflowForm() {
    if (!activeAction) return null;

    if (activeAction === "Add product") {
      if (workflowStep === "form") {
        return (
          <AddProductFlow
            draft={productDraft}
            error={productImageError}
            images={productImages}
            onDraftChange={setProductDraft}
            onImagesSelected={(files) => addMockImages(files, productImages, setProductImages, setProductImageError)}
            onRemoveImage={(index) => setProductImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            onReview={reviewNewProduct}
            locale={locale}
          />
        );
      }
      if (workflowStep === "review") {
        return (
          <section aria-label="Product review" className="workflow-form review-form">
            <div className="form-heading">
              <div><p className="eyebrow">{editLabels.finalReview}</p><h3>{editLabels.review}</h3></div>
              <span className="step-count">{editLabels.stepTwo}</span>
            </div>
            <div className="review-grid">
              <div><span>{editLabels.product}</span><strong>{productDraft.name}</strong></div>
              <div><span>{editLabels.category}</span><strong>{productDraft.category}</strong></div>
              <div><span>{editLabels.variantPack}</span><strong>{productDraft.pack}</strong></div>
              <div><span>{editLabels.retailPrice}</span><strong>₹{Number(productDraft.price).toLocaleString("en-IN")}</strong></div>
              <div><span>{editLabels.systemSku}</span><strong className="sku-value">{generatedSku}</strong></div>
              <div><span>{editLabels.availability}</span><strong>{productDraft.availability}</strong></div>
              {productDraft.description && <div className="review-wide"><span>{editLabels.productDescription}</span><strong>{productDraft.description}</strong></div>}
            </div>
            {productImages.length > 0 && (
              <div className="review-images">
                {productImages.map((image, index) => <img alt={image.name} key={`${image.name}-${index}`} src={image.src} />)}
              </div>
            )}
            <div className="form-footer review-footer">
              <button className="button button-outline" onClick={() => setWorkflowStep("form")} type="button">
                <Icon name="back" size={17} /> {editLabels.goBackEdit}
              </button>
              <button className="button button-primary" onClick={() => setPublishConfirm(true)} type="button">
                <Icon name="check" size={17} /> {editLabels.publishProduct}
              </button>
            </div>
          </section>
        );
      }
      return (
        <section className="workflow-form workflow-complete" role="status">
          <span className="success-icon"><Icon name="check" size={22} /></span>
          <div><h3>{editLabels.published}</h3></div>
          <button className="button button-outline" onClick={() => setActiveAction(null)} type="button">{editLabels.backToActions}</button>
        </section>
      );
    }

    if (workflowStep === "done") {
      return (
        <section className="workflow-form workflow-complete" role="status">
          <span className="success-icon"><Icon name="check" size={22} /></span>
          <div><h3>{editLabels.workflowDone}</h3></div>
          <button className="button button-outline" onClick={() => setActiveAction(null)} type="button">{editLabels.backToActions}</button>
        </section>
      );
    }

    if (workflowStep === "review") {
      const selectedProduct = workflowFields.product;
      const detail = activeAction === "Add variant"
        ? `${workflowFields.pack || "—"} · ₹${workflowFields.price || "—"}`
        : activeAction === "Update product"
          ? `${workflowFields.field}: ${workflowFields.value || "—"}`
          : activeAction === "Change availability"
            ? workflowFields.availability
            : editLabels.archiveNotice;
      return (
        <section className="workflow-form review-form">
          <div className="form-heading"><div><p className="eyebrow">{editLabels.reviewChange}</p><h3>{editLabels.reviewThisChange}</h3></div></div>
          <div className="review-grid">
            <div><span>{editLabels.action}</span><strong>{editLabels.actionLabels[activeAction]}</strong></div>
            <div><span>{editLabels.product}</span><strong>{selectedProduct}</strong></div>
            <div className="review-wide"><span>{editLabels.details}</span><strong>{detail}</strong></div>
          </div>
          <div className="form-footer review-footer">
            <button className="button button-outline" onClick={() => setWorkflowStep("form")} type="button"><Icon name="back" size={17} /> {editLabels.goBack}</button>
            <button className="button button-primary" onClick={confirmWorkflow} type="button"><Icon name="check" size={17} /> {editLabels.confirmChange}</button>
          </div>
        </section>
      );
    }

    return (
      <form className="workflow-form" onSubmit={reviewWorkflow}>
        <div className="form-heading"><div><p className="eyebrow">{editLabels.guidedWorkflow}</p><h3>{editLabels.actionLabels[activeAction]}</h3></div></div>
        <div className="form-grid">
          <label className="form-field form-field-wide">
            {editLabels.product}
            <select onChange={(event) => setWorkflowFields((current) => ({ ...current, product: event.target.value }))} value={workflowFields.product}>
              {products.map((product) => <option key={product.name}>{product.name}</option>)}
            </select>
          </label>
          {activeAction === "Add variant" && (
            <>
              <label className="form-field">{editLabels.packSizeLabel}<input onChange={(event) => setWorkflowFields((current) => ({ ...current, pack: event.target.value }))} placeholder={locale === "hi" ? "जैसे 1 किलोग्राम" : "e.g. 1 kg"} required value={workflowFields.pack} /></label>
              <label className="form-field">{editLabels.retailPrice}<input min="1" onChange={(event) => setWorkflowFields((current) => ({ ...current, price: event.target.value }))} placeholder={locale === "hi" ? "जैसे 1050" : "e.g. 1050"} required type="number" value={workflowFields.price} /></label>
            </>
          )}
          {activeAction === "Update product" && (
            <>
              <label className="form-field">{editLabels.detailToUpdate}<select onChange={(event) => setWorkflowFields((current) => ({ ...current, field: event.target.value }))} value={workflowFields.field}><option>{editLabels.productNameField}</option><option>{editLabels.descriptionField}</option></select></label>
              <label className="form-field">{editLabels.newValue}<input onChange={(event) => setWorkflowFields((current) => ({ ...current, value: event.target.value }))} placeholder={editLabels.valuePlaceholder} required value={workflowFields.value} /></label>
            </>
          )}
          {activeAction === "Change availability" && (
            <label className="form-field form-field-wide">{editLabels.availability}<select onChange={(event) => setWorkflowFields((current) => ({ ...current, availability: event.target.value }))} value={workflowFields.availability}><option>{editLabels.available}</option><option>{editLabels.unavailable}</option></select></label>
          )}
          {activeAction === "Archive product" && <p className="form-field-wide archive-warning">{editLabels.archiveQuestion}</p>}
        </div>
        <div className="form-footer"><p>{editLabels.reviewBeforeConfirm}</p><button className="button button-primary" type="submit">{editLabels.continueReview} <Icon name="arrow-up" size={17} /></button></div>
      </form>
    );
  }

  const askSend = () => submitAsk(askDraft);

  return (
    <div className="app-shell" lang={locale}>
      <header className="topbar">
        <a aria-label={askLabels.homeLabel} className="brand" href="/">
          <span aria-hidden="true" className="brand-mark"><span /><span /></span>
          <span className="brand-copy"><strong>Shahi Meva</strong><small>{askLabels.brandLabel}</small></span>
        </a>
        <div aria-label={askLabels.modeLabel} className="mode-toggle" role="group">
          <button aria-pressed={mode === "ASK"} className={mode === "ASK" ? "mode-active" : ""} onClick={switchToAsk} type="button">ASK</button>
          <button aria-pressed={mode === "EDIT"} className={mode === "EDIT" ? "mode-active" : ""} onClick={openEdit} type="button">
            <Icon name={mode === "EDIT" ? "unlock" : "lock"} size={15} /> EDIT
          </button>
        </div>
        <div className="header-actions">
          <label className="sr-only" htmlFor="header-language">{askLabels.languageLabel}</label>
          <select aria-label={askLabels.languageLabel} className="header-language" id="header-language" onChange={(event) => setLocale(event.target.value as Locale)} value={locale}>
            {(Object.keys(localeNames) as Locale[]).map((key) => <option key={key} value={key}>{localeNames[key]}</option>)}
          </select>
          <button aria-label={askLabels.searchConversation} className="icon-button" onClick={() => setSearchOpen(true)} title={askLabels.searchConversation} type="button"><Icon name="search" /></button>
          <button aria-label={askLabels.aboutPrototype} className="icon-button" onClick={() => setUtilityDialog("info")} title={askLabels.aboutPrototype} type="button"><Icon name="info" /></button>
          <a aria-label={askLabels.openWebsite} className="icon-button" href="https://shahimeva.vercel.app" rel="noopener noreferrer" target="_blank" title={askLabels.openWebsite}><Icon name="external" /></a>
          <button aria-label={askLabels.logout} className="icon-button" onClick={logout} title={askLabels.logout} type="button"><Icon name="logout" size={15} /></button>
        </div>
      </header>

      <main className={`main-layout ${mode === "EDIT" && activeAction === null ? "portal-main-layout" : ""}`}>
        {mode === "EDIT" && activeAction === null ? <MerchantPortal
          locale={locale}
          knowledge={knowledge}
          knowledgeError={knowledgeError}
          knowledgeLoading={knowledgeLoading}
          onKnowledgeChange={setKnowledge}
          onKnowledgeRefresh={refreshKnowledge}
        /> : <>
        <div
          aria-label={mode === "ASK" ? askLabels.conversationLabel : editLabels.conversation}
          className="conversation-scroll"
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 120;
          }}
          ref={scrollRef}
        >
          <section className={`conversation-column ${mode === "EDIT" ? "edit-column" : ""}`}>
            {mode === "ASK" && askMessages.length === 0 && !voiceTranscribing && (
              <div className="empty-state">
                <h1>{askLabels.welcome}</h1>
                <div className="suggestion-list">
                  {askLabels.suggestions.map((suggestion) => (
                    <button className="suggestion" key={suggestion} onClick={() => submitAsk(suggestion)} type="button">
                      {suggestion}<span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mode === "ASK" && askMessages.length > 0 && (
              <MessageThread
                messages={askMessages}
                onCopy={copyResponse}
                copiedMessage={copiedMessage}
                canCopy
                copyLabels={askLabels}
                stoppedMessageIds={stoppedMessageIds}
                stoppedLabel={askLabels.answerStopped}
              />
            )}
            {mode === "ASK" && voiceTranscribing && (
              <div aria-label={askLabels.voiceTranscribingLabel} className="thinking-row thinking-row-user" role="status">
                <span /><span /><span />
              </div>
            )}
            {mode === "ASK" && (thinking || conversationLoading) && !streamingAnswer && (
              <div aria-label={askLabels.thinkingLabel} className="thinking-row" role="status">
                <span /><span /><span /><small>{thinkingMessage}</small>
              </div>
            )}
            {mode === "EDIT" && activeAction !== null && (
              <>
                <MessageThread messages={editMessages} onCopy={copyResponse} copiedMessage={copiedMessage} canCopy={false} copyLabels={askLabels} stoppedMessageIds={stoppedMessageIds} stoppedLabel={askLabels.answerStopped} />
                {renderWorkflowForm()}
              </>
            )}
            {askError && mode === "ASK" && <p className="inline-error" role="alert">{askError}</p>}
            {copyError && mode === "ASK" && <p className="inline-error" role="status">{copyError}</p>}
          </section>
        </div>
        <footer className="composer-dock">
          {composerImageError && mode === "EDIT" && <p className="inline-error" role="alert">{composerImageError}</p>}
          {mode === "ASK" ? <AskComposer
            draft={askDraft}
            disabled={thinking || conversationLoading}
            onDraftChange={setAskDraft}
            onSubmit={askSend}
            onSubmitVoice={(content) => submitAsk(content)}
            onTranscriptionChange={setVoiceTranscribing}
            onStopResponse={stopAskResponse}
            stopResponseLabel={askLabels.stopResponse}
            locale={locale}
          /> : <Composer
            draft={draft}
            disabled={false}
            images={composerImages}
            mode={mode}
            onDeleteRecording={() => undefined}
            onDraftChange={setEditDraft}
            onImagesSelected={(files) => addMockImages(files, composerImages, setComposerImages, setComposerImageError)}
            onPauseRecording={() => undefined}
            onRemoveImage={(index) => setComposerImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            onResumeRecording={() => undefined}
            onSendRecording={() => undefined}
            onStartRecording={() => undefined}
            onSubmit={() => submitEdit()}
            voiceState="idle"
            sendLabel={askLabels.sendMessage}
            editPlaceholder={editLabels.chooseAction}
            editInputLabel={editLabels.conversation}
            addImageLabel={askLabels.addImage}
            maximumImagesLabel={askLabels.maximumTwoImages}
            removeImageLabel={askLabels.removeImage}
          />}
          <div className={`composer-caption${mode === "ASK" ? " ask-caption" : ""}`}>
            {mode === "ASK" ? askLabels.askCaption : editLabels.changesCaption}
          </div>
        </footer>
        </>}
      </main>

      {passwordOpen && (
        <PasswordDialog locale={locale} onClose={() => setPasswordOpen(false)} onUnlock={verifyMerchantPassword} />
      )}
      {publishConfirm && (
        <WorkflowDialog onClose={() => setPublishConfirm(false)} title={editLabels.productPublishConfirm} eyebrow={editLabels.guidedWorkflow} closeLabel={editLabels.closeDialog}>
          <div className="confirm-product"><strong>{productDraft.name}</strong><span>{productDraft.pack} · ₹{Number(productDraft.price).toLocaleString("en-IN")} · {generatedSku}</span></div>
          <div className="dialog-actions">
            <button className="button button-outline" onClick={() => setPublishConfirm(false)} type="button">{editLabels.goBack}</button>
            <button className="button button-primary" onClick={confirmNewProduct} type="button"><Icon name="check" size={17} /> {editLabels.publishProduct}</button>
          </div>
        </WorkflowDialog>
      )}
      {utilityDialog && (
        <WorkflowDialog
          onClose={() => setUtilityDialog(null)}
          title={aboutLabels.title}
          eyebrow={aboutLabels.eyebrow}
          closeLabel={askLabels.closeDialog}
        >
          <div className="utility-copy">
            <p>{aboutLabels.intro}</p>
            <p>{aboutLabels.ask}</p>
            <p>{aboutLabels.voice}</p>
            <p>{aboutLabels.edit}</p>
          </div>
        </WorkflowDialog>
      )}
      {searchOpen && (
        <div
          className="modal-backdrop search-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false);
          }}
          role="presentation"
        >
          <section aria-label={askLabels.searchConversation} aria-modal="true" className="dialog search-dialog" role="dialog">
            <div className="search-dialog-heading"><Icon name="search" /><input autoFocus onChange={(event) => setSearchTerm(event.target.value)} placeholder={askLabels.searchPlaceholder} value={searchTerm} /><button aria-label={askLabels.closeSearch} className="icon-button" onClick={() => setSearchOpen(false)} type="button"><Icon name="close" /></button></div>
            <div className="search-results">
              {!searchTerm.trim() ? <p>{askLabels.searchPrompt}</p> : visibleSearchResults.length ? visibleSearchResults.map((message) => <button key={message.id} onClick={() => setSearchOpen(false)} type="button"><span>{message.role === "user" ? askLabels.searchUser : askLabels.searchAssistant}</span><span>{message.content}</span></button>) : <p>{askLabels.searchNoResults}</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
