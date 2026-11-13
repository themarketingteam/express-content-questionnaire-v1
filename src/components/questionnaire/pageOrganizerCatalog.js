// Original Express service catalog. Headings are only for browsing.
export const EXPRESS_SERVICE_OPTIONS_GROUPED = {
  "CLOUD & INFRASTRUCTURE": ["Cloud Services", "Hybrid Cloud Services", "Internet Services", "Microsoft 365", "Private Cloud Services", "Structured Cabling"],
  "COMPLIANCE": ["CMMC Compliance", "FTC Compliance", "HIPAA Compliance", "IT Compliance", "NIST Framework Compliance", "PCI Compliance", "SOC2 Compliance"],
  "IT SERVICES": ["Co-Managed IT", "Hourly IT Support", "IT Consulting", "IT Help Desk", "Managed IT", "Outsourced IT Help Desk"],
  "SECURITY": ["Cybersecurity", "Ransomware Removal", "Security Awareness Training", "Video Surveillance Solutions"],
  "HARDWARE & RECOVERY": ["Data Backup & Recovery", "Disaster Recovery Planning", "Hardware as a Service", "Printer & Office Machine", "VoIP Phone Systems"]
};

export const EXPRESS_SERVICE_OPTIONS = Object.values(EXPRESS_SERVICE_OPTIONS_GROUPED).flat();

// Picker sections only. Category headings do not create pages or catalog IDs.
export const EXPRESS_INDUSTRY_OPTIONS_GROUPED = {
  "Financial": ["Financial", "CPA", "Accounting", "Insurance Agencies"],
  "Healthcare": ["Healthcare", "Medical", "Dental Practices"],
  "Professional Services": ["Professional Services", "Marketing", "Design Firms", "Legal Firms", "Engineering Firms", "Architecture Firms"],
  "Real Estate": ["Real Estate", "Property Management"],
  "Manufacturing & Construction": ["Manufacturing", "Construction"],
  "Technology": ["Technology", "SaaS Companies"],
  "Education & Nonprofits": ["Education", "Nonprofits"],
  "Government": ["Government", "Municipalities"],
  "Retail, Hospitality & Food Services": ["Retail", "Hospitality", "Food Services"],
  "Agriculture": ["Agriculture", "Farming"],
  "Energy": ["Energy", "Oil", "Gas"],
  "Transportation & Logistics": ["Transportation", "Logistics"]
};

export const EXPRESS_INDUSTRY_OPTIONS = Object.values(EXPRESS_INDUSTRY_OPTIONS_GROUPED).flat().sort();

// Historical choices are recognized when loading saved answers but are never
// offered for new selection. Do not expand or rename them: that changes pages,
// catalog identities, and selection counts in existing client questionnaires.
export const EXPRESS_LEGACY_INDUSTRY_OPTIONS = Object.freeze([
  "Agriculture / Farming",
  "Energy / Oil & Gas",
  "Engineering / Architecture Firms",
  "Financial / Accounting / CPA",
  "Government / Municipalities",
  "Healthcare / Medical",
  "Manufacturing / Construction",
  "Nonprofits / Education",
  "Professional Services (Marketing, Real Estate, etc.)",
  "Real Estate / Property Management",
  "Retail / Hospitality",
  "Technology / SaaS Companies",
  "Transportation / Logistics"
]);

export const EXPRESS_ACCEPTED_INDUSTRY_OPTIONS = Object.freeze([
  ...EXPRESS_INDUSTRY_OPTIONS,
  ...EXPRESS_LEGACY_INDUSTRY_OPTIONS
]);
