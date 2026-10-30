import { redirect } from "next/navigation";

/** Games moved into Life. */
export default function OldGamesPage() {
  redirect("/life/games");
}
