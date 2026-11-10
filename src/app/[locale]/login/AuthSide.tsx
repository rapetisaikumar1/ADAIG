import { getTranslations } from "next-intl/server";

/** Side panel for /login and /signup: a task-specific heading + what the account actually gives you (no removed modules).
 *  The client tagline stays in the footer, so it isn't repeated here. */
export async function AuthSide({ variant = "login" }: { variant?: "login" | "signup" }) {
  const t = await getTranslations("auth");
  const p = variant === "signup" ? "signupSide" : "loginSide";
  return (
    <div className={`auth-side auth-side-${variant}`}>
      <div className="auth-side-inner">
        <h2>{t(`${p}Title`)}</h2>
        <p className="auth-side-lead">{t(`${p}Lead`)}</p>
        <ul className="checks" style={{ color: "#dbe4f0" }}>
          {(["b1", "b2", "b3", "b4"] as const).map((b) => <li key={b}>{t(`${p}_${b}`)}</li>)}
        </ul>
      </div>
    </div>
  );
}
