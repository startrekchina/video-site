import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Field as FieldContainer, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Alert, AlertTitle } from "@/components/ui/alert";

export function Field({ label, help, ...props }: ComponentProps<"input"> & { label: string; help?: string }) {
  return <FieldContainer><FieldLabel htmlFor={props.id}>{label}</FieldLabel><Input {...props} />{help && <FieldDescription>{help}</FieldDescription>}</FieldContainer>;
}
export function Feedback({ message, error }: { message?: string; error?: boolean }) {
  return message ? <Alert role={error ? "alert" : "status"} variant={error ? "destructive" : "default"}><AlertTitle>{message}</AlertTitle></Alert> : null;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage(""); setError(false);
    try { await action(); }
    catch (e) { setError(true); setMessage(e instanceof Error ? e.message : "操作未完成，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return { busy, run, setMessage, clear: () => { setMessage(""); setError(false); }, feedback: <Feedback message={message} error={error} /> };
}
