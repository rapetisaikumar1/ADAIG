import { getTranslations } from "next-intl/server";

/** Side panel for /login and /signup: positioning + what the account actually gives you (no removed modules). */
export async function AuthSide({ variant = "login" }: { variant?: "login" | "signup" }) {
  const t = await getTranslations("auth");
  const p = variant === "signup" ? "signupSide" : "loginSide";
  return (
    <div className="auth-side">
      <div className="auth-side-inner">
        <span className="eyebrow" style={{ color: "var(--teal-300)" }}>{t(`${p}Eyebrow`)}</span>
        <h2>{t("tagline")}</h2>
        <p className="auth-side-lead">{t(`${p}Lead`)}</p>
        <ul className="checks" style={{ color: "#dbe4f0" }}>
          {(["b1", "b2", "b3", "b4"] as const).map((b) => <li key={b}>{t(`${p}_${b}`)}</li>)}
        </ul>
      </div>
    </div>
  );
}
