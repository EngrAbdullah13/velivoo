import { DevBootstrap } from "../../components/dev-bootstrap";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const mode = (await searchParams).mode === "signup" ? "signup" : "signin";
  return <DevBootstrap initialMode={mode} />;
}
