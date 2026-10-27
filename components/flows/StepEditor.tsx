"use client";

import { Plus, Trash2, X } from "lucide-react";
import type { AssignableUser, FlowInputType, FlowMediaType, FlowNodeData, FlowNodeType, FlowOption, Template } from "@/types";
import { BUILT_IN_VARIABLES, FLOW_LIMITS, STEP_META, VARIABLE_RE, carouselSnapshot, templateStartButtons, uid } from "@/lib/flows";
import { CardsEditor } from "./CardsEditor";
import { FormatTextarea } from "./FormatTextarea";

const inputCls =
  "w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 bg-white";
const labelCls = "block text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1.5";

function Counter({ value, max }: { value: string | undefined; max: number }) {
  const n = (value || "").length;
  return <span className={`text-[11px] ${n > max ? "text-red-500 font-semibold" : "text-gray-400"}`}>{n}/{max}</span>;
}

function Field({ label, children, aside }: { label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={labelCls}>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  max,
  titleMax,
  noun,
  withDescription,
}: {
  options: FlowOption[];
  onChange: (next: FlowOption[]) => void;
  max: number;
  titleMax: number;
  noun: string;
  withDescription?: boolean;
}) {
  const update = (i: number, patch: Partial<FlowOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={o.id} className="rounded-lg border border-gray-200 p-2 space-y-1.5 bg-gray-50/50">
          <div className="flex items-center gap-1.5">
            <input
              className={inputCls}
              value={o.title}
              placeholder={`${noun} ${i + 1}`}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="shrink-0 w-8 h-8 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center"
              title={`Remove ${noun.toLowerCase()}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-end -mt-0.5"><Counter value={o.title} max={titleMax} /></div>
          {withDescription && (
            <>
              <input
                className={inputCls}
                value={o.description || ""}
                placeholder="Description (optional)"
                onChange={(e) => update(i, { description: e.target.value })}
              />
              <div className="flex justify-end -mt-0.5"><Counter value={o.description} max={FLOW_LIMITS.rowDescription} /></div>
            </>
          )}
        </div>
      ))}
      {options.length < max && (
        <button
          type="button"
          onClick={() => onChange([...options, { id: uid(noun === "Option" ? "r" : "b"), title: "" }])}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-fg hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add {noun.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function VariableField({
  value,
  onChange,
  required,
  help,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  required?: boolean;
  help: string;
}) {
  const v = value || "";
  const bad = v && !VARIABLE_RE.test(v);
  return (
    <Field label={required ? "Save answer as" : "Save choice as (optional)"}>
      <input
        className={`${inputCls} font-mono ${bad ? "border-red-300" : ""}`}
        value={v}
        placeholder="e.g. preferred_date"
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
      />
      <p className={`text-[11px] mt-1 ${bad ? "text-red-500" : "text-gray-400"}`}>
        {bad ? "Lowercase letters, numbers and _ only." : help}
      </p>
    </Field>
  );
}

export interface StepEditorProps {
  nodeId: string;
  type: FlowNodeType;
  data: FlowNodeData;
  problems: string[];
  /** Applies a change to the step's latest data. */
  onChange: (update: (prev: FlowNodeData) => FlowNodeData) => void;
  onDelete: () => void;
  templates: Template[];
  agents: AssignableUser[];
  variables: string[];
  readOnly?: boolean;
}

export function StepEditor({ type, data, problems, onChange, onDelete, templates, agents, variables, readOnly }: StepEditorProps) {
  const meta = STEP_META[type];
  // Always merged into the step's latest data (see FlowBuilder.updateData).
  const set = (patch: Partial<FlowNodeData>) => onChange((prev) => ({ ...prev, ...patch }));
  const placeholders = [...BUILT_IN_VARIABLES, ...variables];
  const textHelp = (
    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
      Insert: {placeholders.map((p) => (
        <button key={p} type="button" className="font-mono text-brand-fg hover:underline mr-1.5" onClick={() => set({ text: `${data.text || ""}{{${p}}}` })}>
          {`{{${p}}}`}
        </button>
      ))}
    </p>
  );

  return (
    <fieldset disabled={readOnly} className="flex flex-col h-full min-h-0">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
          <h3 className="text-[15px] font-bold text-gray-900">{meta.label}</h3>
          {type !== "trigger" && !readOnly && (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete step
            </button>
          )}
        </div>
        <p className="text-[12px] text-gray-400 mt-1">{meta.hint}</p>
        {problems.length > 0 && (
          <ul className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 space-y-0.5">
            {problems.map((p, i) => <li key={i} className="text-[12px] text-red-600">{p}</li>)}
          </ul>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {type === "trigger" && (
          <>
            <Field label="Copy buttons from a template">
              <select
                className={inputCls}
                value={data.templateId ?? ""}
                onChange={(e) => {
                  const t = templates.find((x) => x.id === Number(e.target.value));
                  if (!t) return set({ templateId: null });
                  set({ templateId: t.id, buttons: templateStartButtons(t) });
                }}
              >
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.cards?.length ? `carousel, ${templateStartButtons(t).length} card buttons` : `${templateStartButtons(t).length} quick replies`})
                    {t.approvalStatus === "SUBMITTED" ? " · pending Meta approval" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                The campaign sends this template. Each of its quick-reply buttons becomes an output below.
              </p>
            </Field>
            <Field label="Template buttons">
              <OptionsEditor
                options={data.buttons || []}
                onChange={(buttons) => set({ buttons })}
                max={10}
                titleMax={25}
                noun="Button"
              />
              <p className="text-[11px] text-gray-400 mt-2">
                {(data.buttons || []).some((b) => /^c\d+_/.test(b.id))
                  ? "Carousel buttons are matched by card, so don't rename them here — pick the template again if it changes."
                  : "Titles must match the template's buttons exactly."}{" "}
                “Any other reply” catches a typed reply to the campaign.
              </p>
            </Field>
          </>
        )}

        {type === "message" && (
          <>
            <Field label="Media">
              <select
                className={inputCls}
                value={data.mediaType || "NONE"}
                onChange={(e) => set({ mediaType: e.target.value as FlowMediaType })}
              >
                <option value="NONE">None</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document (PDF)</option>
              </select>
              {data.mediaType && data.mediaType !== "NONE" && (
                <input
                  className={`${inputCls} mt-2`}
                  value={data.mediaUrl || ""}
                  placeholder="https://… public link to the file"
                  onChange={(e) => set({ mediaUrl: e.target.value })}
                />
              )}
            </Field>
            <Field label="Text" aside={<Counter value={data.text} max={data.buttons?.length || data.link ? FLOW_LIMITS.body : FLOW_LIMITS.text} />}>
              <FormatTextarea
                rows={5}
                className={`${inputCls} resize-y`}
                value={data.text || ""}
                placeholder="Hi {{first_name}}! Here are our laser packages…"
                onChange={(text) => set({ text })}
              />
              {textHelp}
            </Field>
            {/* WhatsApp sends either up to 3 reply buttons or a single link
                button — never both on one message. */}
            <Field label="Buttons">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-gray-100 mb-2.5">
                {([
                  ["reply", "Reply buttons"],
                  ["link", "Link button"],
                ] as const).map(([mode, label]) => {
                  const active = mode === "link" ? !!data.link : !data.link;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        mode === "link"
                          ? set({ link: data.link ?? { title: "View product", url: "" }, buttons: [], variable: undefined })
                          : set({ link: undefined })
                      }
                      className={`rounded-md py-1.5 text-[12px] font-semibold transition-colors ${active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {data.link ? (
                <div className="space-y-2">
                  <div>
                    <input
                      className={inputCls}
                      value={data.link.title}
                      placeholder="Button text, e.g. View product"
                      onChange={(e) => set({ link: { ...data.link!, title: e.target.value } })}
                    />
                    <div className="flex justify-end mt-0.5"><Counter value={data.link.title} max={FLOW_LIMITS.buttonTitle} /></div>
                  </div>
                  <input
                    className={inputCls}
                    value={data.link.url}
                    placeholder="https://… the page it opens"
                    onChange={(e) => set({ link: { ...data.link!, url: e.target.value.trim() } })}
                  />
                  <p className="text-[11px] text-gray-400">
                    Opens the page in the customer&apos;s browser — e.g. one product. A link sends nothing back, so the flow carries on to the next step right away.
                  </p>
                </div>
              ) : (
                <>
                  <OptionsEditor
                    options={data.buttons || []}
                    onChange={(buttons) => set({ buttons })}
                    max={FLOW_LIMITS.buttons}
                    titleMax={FLOW_LIMITS.buttonTitle}
                    noun="Button"
                  />
                  <p className="text-[11px] text-gray-400 mt-2">
                    {(data.buttons || []).length}/{FLOW_LIMITS.buttons} · Each button gets its own branch. No buttons = continue straight to the next step.
                  </p>
                </>
              )}
            </Field>
            {((data.buttons || []).length > 0 || !!data.link) && (
              <Field label="Footer (optional)" aside={<Counter value={data.footer} max={FLOW_LIMITS.footer} />}>
                <input className={inputCls} value={data.footer || ""} onChange={(e) => set({ footer: e.target.value })} />
              </Field>
            )}
            {(data.buttons || []).length > 0 && (
              <VariableField
                value={data.variable}
                onChange={(variable) => set({ variable })}
                help="Stores the tapped button's title in the responses, e.g. service = Laser."
              />
            )}
          </>
        )}

        {type === "list" && (
          <>
            <Field label="Header (optional)" aside={<Counter value={data.header} max={FLOW_LIMITS.header} />}>
              <input className={inputCls} value={data.header || ""} onChange={(e) => set({ header: e.target.value })} />
            </Field>
            <Field label="Text" aside={<Counter value={data.text} max={FLOW_LIMITS.body} />}>
              <FormatTextarea
                rows={4}
                className={`${inputCls} resize-y`}
                value={data.text || ""}
                placeholder="Which treatment are you interested in?"
                onChange={(text) => set({ text })}
              />
              {textHelp}
            </Field>
            <Field label="Menu button label" aside={<Counter value={data.buttonLabel} max={FLOW_LIMITS.listButtonLabel} />}>
              <input className={inputCls} value={data.buttonLabel || ""} onChange={(e) => set({ buttonLabel: e.target.value })} />
            </Field>
            <Field label={`Options (${(data.rows || []).length}/${FLOW_LIMITS.listRows})`}>
              <OptionsEditor
                options={data.rows || []}
                onChange={(rows) => set({ rows })}
                max={FLOW_LIMITS.listRows}
                titleMax={FLOW_LIMITS.rowTitle}
                noun="Option"
                withDescription
              />
            </Field>
            <Field label="Footer (optional)" aside={<Counter value={data.footer} max={FLOW_LIMITS.footer} />}>
              <input className={inputCls} value={data.footer || ""} onChange={(e) => set({ footer: e.target.value })} />
            </Field>
            <VariableField
              value={data.variable}
              onChange={(variable) => set({ variable })}
              help="Stores the chosen option in the responses, e.g. treatment = IV Drip."
            />
          </>
        )}

        {type === "cards" && (
          <>
            <Field label="Message above the cards" aside={<Counter value={data.text} max={FLOW_LIMITS.body} />}>
              <FormatTextarea
                rows={3}
                className={`${inputCls} resize-y`}
                value={data.text || ""}
                placeholder="✨ Discover our Skin & Rejuvenation offers — swipe to see them all 👉"
                onChange={(text) => set({ text })}
              />
              {textHelp}
            </Field>
            <Field label="Cards">
              <CardsEditor
                cards={data.cards || []}
                onChange={(update) => onChange((prev) => ({ ...prev, cards: update(prev.cards || []) }))}
              />
            </Field>
            <VariableField
              value={data.variable}
              onChange={(variable) => set({ variable })}
              help="Stores which product was tapped (its first line), e.g. offer = Ulthera Skin Tightening."
            />
          </>
        )}

        {type === "carousel" && (
          <>
            <Field label="Carousel template">
              <select
                className={inputCls}
                value={data.templateId ?? ""}
                onChange={(e) => {
                  const t = templates.find((x) => x.id === Number(e.target.value));
                  if (!t) return set({ templateId: null, cards: [] });
                  set({ templateId: t.id, cards: carouselSnapshot(t) });
                }}
              >
                <option value="">Choose a carousel template…</option>
                {templates.filter((t) => t.cards && t.cards.length).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.cards!.length} cards){t.approvalStatus === "SUBMITTED" ? " · pending Meta approval" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Build carousels in Templates → New template → Carousel. Meta must approve it before it can be sent.
              </p>
            </Field>
            {(data.cards || []).length > 0 && (
              <Field label="Cards">
                <ul className="space-y-1.5">
                  {(data.cards || []).map((c, i) => (
                    <li key={i} className="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
                      <p className="text-[12px] font-semibold text-gray-800">{i + 1}. {c.label}</p>
                      <p className="text-[11px] text-gray-500">
                        {c.buttons.length ? c.buttons.map((b) => b.title).join(", ") : "Link buttons only"}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-gray-400 mt-2">
                  Each card&apos;s quick reply gets its own branch. Link buttons just open the link.
                </p>
              </Field>
            )}
            <VariableField
              value={data.variable}
              onChange={(variable) => set({ variable })}
              help="Stores which card was tapped, e.g. offer = Laser · Interested."
            />
          </>
        )}

        {type === "question" && (
          <>
            <Field label="Question" aside={<Counter value={data.text} max={FLOW_LIMITS.text} />}>
              <FormatTextarea
                rows={4}
                className={`${inputCls} resize-y`}
                value={data.text || ""}
                placeholder="What date would suit you? (DD/MM/YYYY)"
                onChange={(text) => set({ text })}
              />
              {textHelp}
            </Field>
            <Field label="Expected answer">
              <select
                className={inputCls}
                value={data.inputType || "text"}
                onChange={(e) => set({ inputType: e.target.value as FlowInputType })}
              >
                <option value="text">Any text</option>
                <option value="date">Date (DD/MM/YYYY)</option>
                <option value="number">Number</option>
                <option value="phone">Phone number</option>
                <option value="email">Email</option>
              </select>
            </Field>
            <VariableField
              required
              value={data.variable}
              onChange={(variable) => set({ variable })}
              help="The column this answer appears under in Responses."
            />
            <Field label="If the answer doesn't fit (optional)">
              <input
                className={inputCls}
                value={data.errorText || ""}
                placeholder="Please send the date as DD/MM/YYYY."
                onChange={(e) => set({ errorText: e.target.value })}
              />
              <p className="text-[11px] text-gray-400 mt-1">The customer is asked again until the answer is valid.</p>
            </Field>
          </>
        )}

        {type === "slot_picker" && (
          // Retired step in an older flow: the flow can't be saved until it's gone.
          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
            The Pick appointment step is no longer available. Delete this step and connect the step before it to what
            should happen next — the flow can&apos;t be saved while it&apos;s here. Until then, a patient who reaches it
            is handed to the team.
          </p>
        )}

        {type === "tag" && (
          <Field label="Tag">
            <input
              className={inputCls}
              value={data.tag || ""}
              placeholder="Interested – Laser"
              onChange={(e) => set({ tag: e.target.value })}
            />
            <p className="text-[11px] text-gray-400 mt-1">Added to the customer&apos;s profile, so you can build segments from it.</p>
          </Field>
        )}

        {type === "assign" && (
          <>
            <Field label="Assign to">
              <select
                className={inputCls}
                value={data.agentId ?? ""}
                onChange={(e) => set({ agentId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">The team (leave in the Unassigned queue)</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.username}</option>)}
              </select>
            </Field>
            <Field label="Message before handing over (optional)">
              <FormatTextarea
                rows={3}
                className={`${inputCls} resize-y`}
                value={data.text || ""}
                onChange={(text) => set({ text })}
              />
              {textHelp}
            </Field>
            <p className="text-[12px] text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Automation stops here. An agent replying by hand in the chat also stops it.
            </p>
          </>
        )}

        {type === "end" && (
          <Field label="Closing message (optional)">
            <FormatTextarea
              rows={3}
              className={`${inputCls} resize-y`}
              value={data.text || ""}
              placeholder="Thank you! We'll be in touch."
              onChange={(text) => set({ text })}
            />
            {textHelp}
          </Field>
        )}
      </div>
    </fieldset>
  );
}
