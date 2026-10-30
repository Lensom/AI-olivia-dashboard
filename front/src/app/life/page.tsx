import { redirect } from "next/navigation";

/** Life has no overview of its own: open its first page. */
export default function LifePage() {
  redirect("/life/tasks");
}
