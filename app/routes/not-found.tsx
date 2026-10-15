import { data } from "react-router";
import { pageTitle } from "@/lib/site";
export { NotFoundPage as default } from "@/components/site/not-found";

// A matched 404 keeps the authenticated root layout and still returns HTTP 404.
export function loader() { return data(null, { status: 404 }); }
export const meta = () => pageTitle("页面不存在");
