import { getTranslations } from "next-intl/server";
export async function AuthSide() {
  const t = await getTranslations("auth");
  return <div className="auth-side"><span className="eyebrow" style={{ color: "var(--teal-300)" }}>{t("members")}</span><h2>{t("side")}</h2><ul className="checks" style={{ color: "#dbe4f0" }}><li>{t("b1")}</li><li>{t("b2")}</li><li>{t("b3")}</li></ul></div>;
}
