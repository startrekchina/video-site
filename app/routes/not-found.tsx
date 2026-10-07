import { data } from "react-router";
export { NotFoundPage as default } from "@/components/site/not-found";

// A matched 404 keeps the authenticated root layout and still returns HTTP 404.
export function loader() { return data(null, { status: 404 }); }
