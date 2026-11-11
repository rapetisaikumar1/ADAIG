import { getTranslations } from "next-intl/server";
import { getSiteInfo } from "@/lib/settings";
import { Icon } from "@/components/ui/Icon";

/**
 * Public contact email and postal address from Admin → Settings. Both are empty by default, and then nothing is rendered
 * (the contact page looks exactly as before).
 */
export async function SiteContactInfo() {
  const { contactEmail, postalAddress } = await getSiteInfo();
  if (!contactEmail && !postalAddress) return null;
  const t = await getTranslations("siteInfo");
  return (
    <section className="card site-contact-info" aria-labelledby="site-contact-h">
      <h2 id="site-contact-h">{t("title")}</h2>
      <dl>
        {contactEmail && <div><dt><Icon name="mail" size={18} />{t("email")}</dt><dd><a href={`mailto:${contactEmail}`}>{contactEmail}</a></dd></div>}
        {postalAddress && <div><dt><Icon name="map-pin" size={18} />{t("address")}</dt><dd><address>{postalAddress}</address></dd></div>}
      </dl>
    </section>
  );
}
