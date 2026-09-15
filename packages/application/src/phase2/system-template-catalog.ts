import type { StructuredEmailDocument } from "../../../domain/src/phase2/content.js";

export type StarterTemplateType = "email";
export interface SystemStarterTemplate {
  id: string;
  name: string;
  category: string;
  type: StarterTemplateType;
  useCase: string;
  industry: string;
  style: string;
  tags: readonly string[];
  document: StructuredEmailDocument;
  subject: string;
  preheader: string;
  plainText: string;
  settings: Record<string, unknown>;
}

const textStyle = { fontFamily: "Arial, sans-serif" as const, color: "#302a42", fontSize: 16, lineHeight: 1.55 };
const headingStyle = { fontFamily: "Arial, sans-serif" as const, color: "#241b3d", fontSize: 32, lineHeight: 1.2, fontWeight: "bold" as const };
const footer = { id: "compliance", type: "compliance_footer" as const, locked: true as const };
const image = (id: string, src: string, alt: string) => ({ id, type: "image" as const, src, alt, width: 600, align: "center" as const, borderRadius: 12, spacing: { bottom: 20 } });
const button = (id: string, label: string, color = "#6846ed") => ({ id, type: "button" as const, label, url: "https://example.com", align: "center" as const, backgroundColor: color, textColor: "#ffffff", borderColor: color, spacing: { bottom: 20 } });
const baseSettings = (accent: string): Record<string, unknown> => ({ templateType: "email", bodyBackgroundColor: "#ffffff", backgroundColor: "#f5f3f8", emailWidth: 640, fontFamily: "Arial, sans-serif", headingFontSize: 32, bodyFontSize: 16, buttonStyle: "solid", buttonRadius: 8, defaultLinkColor: accent, spacingScale: "comfortable", footerStyle: "compliance", trackingEnabled: true, plainTextMode: "auto" });

/**
 * Add future system templates here. The catalog is immutable, contains only
 * structured-email data, and is copied into a workspace before authoring.
 */
export const SYSTEM_STARTER_TEMPLATES: readonly SystemStarterTemplate[] = [
  {
    id: "saas-product-launch", name: "SaaS Product Launch", category: "Product launch", type: "email", useCase: "Sell a SaaS product, book demos, or drive free-trial signups.", industry: "SaaS", style: "Modern", tags: ["saas", "launch", "trial", "demo"], subject: "Meet the faster way to get work done", preheader: "A smarter workflow is ready when you are.", plainText: "Meet your new workspace. See what is new, hear from teams already using it, and start your free trial today.", settings: baseSettings("#6846ed"),
    document: { schemaVersion: 1, blocks: [
      { id: "saas-header", type: "header", text: "NORTHSTAR", align: "center", style: { ...textStyle, fontSize: 18, fontWeight: "bold", color: "#6846ed" }, spacing: { bottom: 28 } },
      { id: "saas-title", type: "heading", level: 1, text: "Your team’s next best workflow starts here.", align: "center", style: headingStyle, spacing: { bottom: 16 } },
      { id: "saas-copy", type: "text", text: "Northstar brings plans, people, and progress into one calm, focused workspace—so every team can move with confidence.", align: "center", style: textStyle, spacing: { bottom: 20 } },
      { id: "saas-features", type: "columns", columns: [
        { id: "saas-feature-one", blocks: [{ id: "saas-feature-one-heading", type: "heading", level: 3, text: "One clear view", style: { ...textStyle, fontSize: 16, fontWeight: "bold" } }, { id: "saas-feature-one-copy", type: "text", text: "Keep every priority and owner visible.", style: { ...textStyle, fontSize: 13 } }] },
        { id: "saas-feature-two", blocks: [{ id: "saas-feature-two-heading", type: "heading", level: 3, text: "Built to ship", style: { ...textStyle, fontSize: 16, fontWeight: "bold" } }, { id: "saas-feature-two-copy", type: "text", text: "Turn decisions into momentum, quickly.", style: { ...textStyle, fontSize: 13 } }] }
      ], spacing: { bottom: 20 } },
      image("saas-product", "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80", "A team collaborating around a table"),
      { id: "saas-proof", type: "text", text: "“Northstar cut our weekly planning time in half—and made the whole team more aligned.” — Maya, Operations Lead", align: "center", style: { ...textStyle, fontSize: 14, italic: true, color: "#5d556d" }, spacing: { bottom: 20 } },
      button("saas-cta", "Start your free trial"), footer
    ] }
  },
  {
    id: "skincare-brand-promo", name: "Skincare Brand Promo", category: "Promotion", type: "email", useCase: "Promote skincare products, launches, and seasonal offers.", industry: "Beauty", style: "Editorial", tags: ["skincare", "ecommerce", "promotion", "beauty"], subject: "Your glow starts with a gentler ritual", preheader: "Meet the new essentials, with 15% off this week.", plainText: "Discover our new skincare essentials, made for your everyday ritual. Enjoy 15% off this week.", settings: baseSettings("#b34e70"),
    document: { schemaVersion: 1, blocks: [
      { id: "skin-header", type: "header", text: "LUMIÈRE SKIN", align: "center", style: { ...textStyle, fontSize: 18, fontWeight: "bold", color: "#9c4663" }, spacing: { bottom: 22 } },
      image("skin-hero", "https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=1200&q=80", "Skincare product bottles"),
      { id: "skin-title", type: "heading", level: 1, text: "A softer ritual for brighter days.", align: "center", style: headingStyle, spacing: { bottom: 14 } },
      { id: "skin-benefits", type: "columns", columns: [
        { id: "skin-benefit-one", blocks: [{ id: "skin-benefit-one-title", type: "heading", level: 3, text: "Barrier-first", style: { ...textStyle, fontSize: 15, fontWeight: "bold" } }, { id: "skin-benefit-one-copy", type: "text", text: "Nourish and protect every day.", style: { ...textStyle, fontSize: 13 } }] },
        { id: "skin-benefit-two", blocks: [{ id: "skin-benefit-two-title", type: "heading", level: 3, text: "Thoughtfully made", style: { ...textStyle, fontSize: 15, fontWeight: "bold" } }, { id: "skin-benefit-two-copy", type: "text", text: "Effective care, no unnecessary extras.", style: { ...textStyle, fontSize: 13 } }] }
      ], spacing: { bottom: 20 } },
      image("skin-lifestyle", "https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=1200&q=80", "A calming self-care routine"),
      { id: "skin-products", type: "text", text: "Featured essentials: Cloud Cleanser · Daily Dew Serum · Night Renewal Cream", align: "center", style: { ...textStyle, fontSize: 14, fontWeight: "bold" }, spacing: { bottom: 12 } },
      button("skin-cta", "Enjoy 15% off", "#b34e70"),
      { id: "skin-trust", type: "text", text: "Dermatologist tested · Vegan formulas · Free shipping over $50", align: "center", style: { ...textStyle, fontSize: 12, color: "#756a75" }, spacing: { bottom: 18 } }, footer
    ] }
  },
  {
    id: "reminder", name: "Reminder Template", category: "Lifecycle", type: "email", useCase: "Send webinar, appointment, renewal, or payment reminders.", industry: "General", style: "Minimal", tags: ["reminder", "webinar", "appointment", "renewal"], subject: "Reminder: your session starts tomorrow", preheader: "Save your seat and join us at the scheduled time.", plainText: "Reminder: your session starts tomorrow. Review the time and join from the link provided.", settings: baseSettings("#3468c0"),
    document: { schemaVersion: 1, blocks: [
      { id: "reminder-header", type: "header", text: "NORTHSTAR EVENTS", align: "center", style: { ...textStyle, fontSize: 15, fontWeight: "bold", color: "#3468c0" }, spacing: { bottom: 30 } },
      { id: "reminder-title", type: "heading", level: 1, text: "A quick reminder—you're on the list.", align: "center", style: headingStyle, spacing: { bottom: 16 } },
      { id: "reminder-date", type: "text", text: "THURSDAY, OCTOBER 24 · 10:00 AM PT", align: "center", style: { ...textStyle, fontSize: 15, fontWeight: "bold", color: "#3468c0" }, spacing: { bottom: 18 } },
      { id: "reminder-copy", type: "text", text: "Join us for a practical session with ideas you can put to work immediately. We’ll reserve your place until the session begins.", align: "center", style: textStyle, spacing: { bottom: 20 } },
      button("reminder-cta", "View event details", "#3468c0"),
      { id: "reminder-note", type: "text", text: "Can’t make it live? Register anyway and we’ll send the replay.", align: "center", style: { ...textStyle, fontSize: 13, color: "#756d80" }, spacing: { bottom: 12 } },
      { id: "reminder-support", type: "text", text: "Questions? Reply to this email and our team will help.", align: "center", style: { ...textStyle, fontSize: 12, color: "#756d80" }, spacing: { bottom: 18 } }, footer
    ] }
  },
  {
    id: "weekly-newsletter-digest", name: "Weekly Newsletter / Digest", category: "Newsletter", type: "email", useCase: "Share weekly updates, blog posts, resources, or community news.", industry: "Media", style: "Editorial", tags: ["newsletter", "digest", "community", "updates"], subject: "The Weekly Signal: ideas worth carrying forward", preheader: "Three fresh reads for a clearer week ahead.", plainText: "The Weekly Signal: a featured story and three resources for your week ahead.", settings: baseSettings("#0b7a6d"),
    document: { schemaVersion: 1, blocks: [
      { id: "digest-title", type: "heading", level: 1, text: "THE WEEKLY SIGNAL", align: "center", style: { ...headingStyle, fontSize: 28, color: "#0b7a6d" }, spacing: { bottom: 12 } },
      { id: "digest-intro", type: "text", text: "A calm collection of ideas, stories, and resources for your week ahead.", align: "center", style: textStyle, spacing: { bottom: 20 } },
      image("digest-feature", "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80", "A person writing at a desk"),
      { id: "digest-feature-title", type: "heading", level: 2, text: "The quiet habits behind teams that keep learning", style: { ...headingStyle, fontSize: 23 }, spacing: { bottom: 8 } },
      { id: "digest-feature-copy", type: "text", text: "A closer look at how resilient teams make space for better questions, not just faster answers.", style: textStyle, spacing: { bottom: 16 } },
      { id: "digest-resources", type: "columns", columns: [
        { id: "digest-resource-one", blocks: [{ id: "digest-resource-one-title", type: "heading", level: 3, text: "Read", style: { ...textStyle, fontSize: 15, fontWeight: "bold" } }, { id: "digest-resource-one-copy", type: "text", text: "A guide to useful async rituals.", style: { ...textStyle, fontSize: 13 } }] },
        { id: "digest-resource-two", blocks: [{ id: "digest-resource-two-title", type: "heading", level: 3, text: "Listen", style: { ...textStyle, fontSize: 15, fontWeight: "bold" } }, { id: "digest-resource-two-copy", type: "text", text: "A conversation on creative focus.", style: { ...textStyle, fontSize: 13 } }] }
      ], spacing: { bottom: 20 } },
      button("digest-cta", "Read this week’s stories", "#0b7a6d"),
      { id: "digest-social", type: "social", links: [{ label: "Instagram", url: "https://example.com" }, { label: "LinkedIn", url: "https://example.com" }, { label: "Website", url: "https://example.com" }] }, footer
    ] }
  },
  {
    id: "abandoned-cart-recovery", name: "Abandoned Cart / Product Recovery", category: "Ecommerce", type: "email", useCase: "Recover an abandoned cart with a product reminder or time-bound offer.", industry: "Ecommerce", style: "Conversion", tags: ["cart", "recovery", "ecommerce", "offer"], subject: "Your favorites are still waiting", preheader: "Complete your order and enjoy a little something extra.", plainText: "Your cart is still waiting. Complete your order today and enjoy a little something extra.", settings: baseSettings("#d16437"),
    document: { schemaVersion: 1, blocks: [
      { id: "cart-header", type: "header", text: "FIELD & FORM", align: "center", style: { ...textStyle, fontSize: 18, fontWeight: "bold", color: "#d16437" }, spacing: { bottom: 24 } },
      { id: "cart-title", type: "heading", level: 1, text: "Still thinking it over?", align: "center", style: headingStyle, spacing: { bottom: 14 } },
      { id: "cart-copy", type: "text", text: "The items in your cart are ready whenever you are. Take another look before they’re gone.", align: "center", style: textStyle, spacing: { bottom: 18 } },
      image("cart-product", "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80", "Featured product from your cart"),
      { id: "cart-price", type: "text", text: "YOUR CART · $84.00\nUse code COME-BACK for 10% off today.", align: "center", style: { ...textStyle, fontSize: 15, fontWeight: "bold", color: "#a64f2a" }, spacing: { bottom: 18 } },
      button("cart-cta", "Return to your cart", "#d16437"),
      { id: "cart-reassurance", type: "text", text: "Free shipping over $50 · Easy 30-day returns · Secure checkout", align: "center", style: { ...textStyle, fontSize: 12, color: "#756d80" }, spacing: { bottom: 12 } },
      { id: "cart-trust", type: "text", text: "Thousands of customers trust Field & Form for considered everyday essentials.", align: "center", style: { ...textStyle, fontSize: 12, color: "#756d80" }, spacing: { bottom: 18 } }, footer
    ] }
  }
];

export function systemStarterTemplate(id: string): SystemStarterTemplate | undefined {
  return SYSTEM_STARTER_TEMPLATES.find(template => template.id === id);
}
