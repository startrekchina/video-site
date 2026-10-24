import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Field as FieldContainer, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

export function Field({ label, help, ...props }: ComponentProps<"input"> & { label: string; help?: string }) {
  return <FieldContainer><FieldLabel htmlFor={props.id}>{label}</FieldLabel><Input {...props} />{help && <FieldDescription>{help}</FieldDescription>}</FieldContainer>;
}
export function Feedback({ message, error }: { message?: string; error?: boolean }) {
  return message ? <Alert role={error ? "alert" : "status"} variant={error ? "destructive" : "default"}><AlertTitle>{message}</AlertTitle></Alert> : null;
}
/** inline: failures show in `feedback` inside the form or dialog that caused them; elsewhere they are toasts, so the page never shifts. */
export function useAction(inline = true) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage(""); setError(false);
    try { await action(); }
    catch (e) {
      const text = e instanceof Error ? e.message : "操作未完成，请稍后重试。";
      if (inline) { setError(true); setMessage(text); } else toast.add({ title: text, type: "error" });
    }
    finally { setBusy(false); }
  }
  return { busy, run, setMessage, clear: () => { setMessage(""); setError(false); }, feedback: <Feedback message={message} error={error} /> };
}
