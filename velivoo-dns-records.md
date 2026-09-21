---
pdf_options:
  format: A4
  margin: 18mm
stylesheet: []
---

# velivoo.com — DNS Records

| # | Type | Host (GoDaddy) | Value |
| --- | --- | --- | --- |
| 1 | CNAME | vm1._domainkey | vm1.d_f55755f1.dkim.velivoo.com |
| 2 | CNAME | vm2._domainkey | vm2.d_f55755f1.dkim.velivoo.com |
| 3 | TXT | _dmarc | v=DMARC1; p=none |
| 4 | MX | bounce | Priority **10** — feedback-smtp.eu-north-1.amazonses.com |
| 5 | TXT | bounce | v=spf1 include:amazonses.com ~all |
| 6 | TXT | @ | velivoo-site-verification=lza4507sWcNhOiZ8UI4zImmZ4lxSNid4 |
| 7 | CNAME | links | d_f55755f1.send.velivoo.com |
