/**
 * Helper/info copy for each Express questionnaire question.
 * Displayed in InfoModal when a user clicks the info icon.
 */
export const HELPER_COPY = {
  q1: {
    title: "What type of IT company are you?",
    why: "This helps us align your site to your operating model. A Managed Services Provider markets differently than a Cloud Hosting Provider or a Cybersecurity Specialist. Matching your model ensures the right language, examples, and CTAs that attract the right clients.",
    guidance: "Pick up to three that describe your business today (not future plans). If you don't see a perfect fit, choose the closest items and use 'Other' to clarify briefly.",
    type: "checkbox",
    examples: {
      selections: ["Managed Services Provider (MSP)", "Cybersecurity Provider", "Co-Managed IT Partner"],
      mixed: ["Managed Services Provider (MSP)", "Co-Managed IT Partner"],
      other: "IT Staff Augmentation and Fractional IT Management",
      shortAnswer: ""
    }
  },
  q2: {
    title: "What are your primary service offerings?",
    why: "Your service focus drives navigation, page structure, and SEO priorities. Choosing your top services ensures the site showcases what you most want to sell, not just a generic list.",
    guidance: "Select up to three of your strongest or most profitable services. If unlisted, use 'Other' with the label you use in sales calls.",
    type: "checkbox",
    examples: {
      selections: ["Managed IT Services", "Microsoft 365 Services", "Security Awareness Training"],
      mixed: ["Managed IT Services", "Cybersecurity Services", "Data Backup & Recovery"],
      other: "Fractional vCISO Support and Compliance Consulting",
      shortAnswer: ""
    }
  },
  q3: {
    title: "What makes your company different from other MSPs in your area?",
    why: "This is your unique selling proposition (USP). Prospects compare providers; we'll use this answer for headlines, hero copy, and proof points that make you memorable.",
    guidance: "Write 2–3 sentences focusing on outcomes, responsiveness, specialization, or experience. Avoid vague claims—back them up with something measurable or tangible.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "We're a locally owned MSP with a live-help desk and an average 10-minute response time. Clients stay with us because we explain issues in plain English and include proactive security-by-default—patching, backups, and 24/7 monitoring—without surprise fees."
    }
  },
  q4: {
    title: "What is your primary city of service or geological region of service?",
    why: "Your service region shapes local SEO and credibility. Listing a specific city or county helps nearby businesses find you and signals that you're truly local to the area.",
    guidance: "We recommend selecting a specific city or town for best results. If you serve a broader area, you may select a county or region. State and country selections are less effective for local SEO. Choose a validated option from the dropdown list.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "Nashville, Tennessee or Davidson County, Tennessee"
    }
  },
  q5: {
    title: "How do you typically price or package your services?",
    why: "Clarity on pricing models helps us set accurate expectations on your site. Flat-rate MSPs should sound predictable; project-based firms should sound flexible.",
    guidance: "Pick the model you use most. If you mix models, choose the most common and add any nuance under 'Other'.",
    type: "multiple",
    examples: {
      selections: ["Flat-rate monthly (fully managed)", "Hourly or project-based", "Hybrid"],
      mixed: ["Flat-rate monthly (fully managed)", "Hybrid"],
      other: "Flat monthly plan for SMBs with hourly options for specialized projects",
      shortAnswer: ""
    }
  },
  q6: {
    title: "What are your company's biggest goals over the next year?",
    why: "Your goals guide UX, copy, and CTA strategy. If you want leads, we optimize for conversions; if rebranding or recruiting, we emphasize tone and credibility.",
    guidance: "Select up to three priorities that truly reflect your next 12 months. We'll align page structure and messaging to support those outcomes.",
    type: "checkbox",
    examples: {
      selections: ["Acquire more clients", "Improve recurring revenue", "Expand into new markets"],
      mixed: ["Acquire more clients", "Strengthen cybersecurity offering", "Rebrand / modernize web presence"],
      other: "Launch a managed cloud division targeting medical practices",
      shortAnswer: ""
    }
  },
  q7: {
    title: "What tone best describes how you want your brand to sound on your website?",
    why: "Tone shapes how prospects feel about you. Technical signals expertise; friendly signals approachability; bold can drive action. We'll match content to your voice.",
    guidance: "Pick the tone that matches how you talk to clients today. Use 'Other' if you want a blended voice (e.g., friendly but evidence-led).",
    type: "multiple",
    examples: {
      selections: ["Technical and expert-driven", "Friendly and approachable", "Bold and confident"],
      mixed: ["Friendly and approachable", "Technical and expert-driven"],
      other: "Down-to-earth and educational—plain English with evidence",
      shortAnswer: ""
    }
  },
  q8: {
    title: "What types of businesses do you primarily serve?",
    why: "Industry targeting improves relevance and conversion. Healthcare, legal, and manufacturing audiences need different language, visuals, and compliance cues.",
    guidance: "Check the industries you actively serve. If you have a niche that isn't listed, use 'Other' and name it clearly.",
    type: "checkbox",
    examples: {
      selections: ["Healthcare / Medical", "Financial / Accounting / CPA", "Manufacturing / Construction"],
      mixed: ["Legal Firms", "Nonprofits / Education", "Professional Services (Marketing, Real Estate, etc.)"],
      other: "Architecture & Engineering Firms",
      shortAnswer: ""
    }
  },
  q9: {
    title: "What is the typical size of your client companies?",
    why: "Company size affects needs and budgets. This helps us address the right buyers (owners vs. IT directors) and frame the value you deliver.",
    guidance: "Pick the range that best matches your average client. If many are larger than 100+ employees, choose the corresponding bracket.",
    type: "multiple",
    examples: {
      selections: ["1–25 employees", "26–50 employees", "51–100 employees", "100–250 employees", "250+ employees"],
      mixed: ["51–100 employees", "100–250 employees"],
      other: "",
      shortAnswer: ""
    }
  },
  q10: {
    title: "What are the main IT challenges your clients come to you for help with?",
    why: "Stating real pain points helps visitors feel understood. We'll echo these problems on your homepage and service pages to build trust quickly.",
    guidance: "Choose up to three issues clients mention most often in discovery calls or tickets. Use 'Other' for anything specific to your niche.",
    type: "checkbox",
    examples: {
      selections: ["Cybersecurity concerns or breaches", "Frequent downtime or slow networks", "Unreliable backups or disaster recovery"],
      mixed: ["Compliance and data protection needs", "Difficulty scaling with growth", "Outdated or inefficient systems"],
      other: "Struggling to meet HIPAA or CMMC compliance requirements",
      shortAnswer: ""
    }
  },
  q11: {
    title: "What outcomes do your clients want most from working with you?",
    why: "Benefits sell better than features. We'll highlight outcomes in headlines and case studies to show what clients get—not just what you do.",
    guidance: "Pick up to two results clients consistently achieve with you. Think of what they thank you for after a few months together.",
    type: "checkbox",
    examples: {
      selections: ["Predictable monthly IT costs", "Peace of mind about security", "Fewer day-to-day IT problems"],
      mixed: ["Faster response and resolution", "Strategic technology guidance", "Compliance confidence"],
      other: "Improved internal IT team performance through co-managed support",
      shortAnswer: ""
    }
  },
  q12: {
    title: "Briefly describe your ideal client.",
    why: "This defines who your site should speak to, so you attract more of the right clients. It also helps filter out poor fit leads early.",
    guidance: "Write one sentence that includes size, industry, location, and mindset. Imagine describing your favorite client to a friend.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "A healthcare or dental practice with 20–100 employees in the Nashville area that values proactive IT management, clear communication, and a long-term partnership."
    }
  }
};