import { redirect } from "next/navigation";

/** Tasks moved into Life. */
export default function OldTasksPage() {
  redirect("/life/tasks");
}
