# Data Processing Agreement

Between **[Business registered name]**, [address] ("the Business", the
**Personal Information Controller**)

and **[Semivra legal name]**, [address] ("Semivra", the **Personal Information
Processor**)

Effective: [date]

This agreement governs how Semivra processes personal information for the
Business while providing the Semivra Libellus point-of-sale and management
system (the "Service"). It is made under Sections 43 to 45 of the Implementing
Rules and Regulations of the Data Privacy Act of 2012 (RA 10173).

## 1. What Semivra processes

| Category | Examples | Data subjects |
|---|---|---|
| Customer information | Name, phone, delivery address, order history, table | Customers |
| Senior citizen / PWD details | Name and OSCA / PWD ID number recorded for a statutory discount | Customers (**sensitive**) |
| Client accounts | Contact person, phone, email, registered name and address, TIN, credit terms and balance | Business clients |
| Staff information | Name, role, login, hashed password and PIN, clock and shift records, pay, **SSS / PhilHealth / Pag-IBIG / TIN** | Staff (**sensitive**) |
| Supplier contacts | Contact person, phone, email, address, TIN | Supplier representatives |
| System records | Audit trail of actions, sign-in sessions and the device used | Staff |

## 2. What Semivra may do with it

Semivra processes the information **only** to provide, host, secure, back up,
support and fix the Service, and only on the Business's documented
instructions - which this agreement and the Business's use of the Service
constitute. Semivra will not:

- use the information for its own purposes, sell it, or use it for advertising
  or profiling;
- disclose it to anyone except the sub-processors in section 4, or where the
  law compels it (and then, where the law allows, it will tell the Business
  first);
- keep it after the agreement ends, except as section 8 allows.

## 3. Security

Semivra maintains the organizational, physical and technical measures the DPA
requires, including, as the Service stands today:

- encryption in transit (HTTPS/TLS) between devices and the Service;
- passwords and PINs stored only as salted one-way hashes (bcrypt);
- short-lived sign-in tokens (15 minutes) with server-side revocable sessions;
- role- and permission-based access down to individual screens, enforced by
  the server;
- an audit trail of changes, recording who made them;
- customer-portal accounts that can see only their own orders;
- input sanitisation against query injection, and automated tests of the above;
- a separate database for each business. All businesses' databases run on
  one shared database server, so the separation is logical (the software only
  ever opens its own business's database), not separate machines;
- government ID numbers (SSS, PhilHealth, Pag-IBIG, TIN), two-step sign-in
  secrets and senior citizen/PWD card numbers additionally encrypted at rest;
- daily backups of the database, checked by a test restore before they are
  kept, and an encrypted copy held off the server (see section 4).

Semivra limits access by its own personnel to those who need it to run the
Service, binds them to confidentiality, and trains them on it.

## 4. Sub-processors

The Business authorises these sub-processors:

| Sub-processor | Service | Location |
|---|---|---|
| [Server host, e.g. Hostinger] | The server that runs the application **and the database** (a self-managed MongoDB on the same server; MongoDB, Inc. does not hold the data) | [location] |
| [Offsite backup storage: Cloudflare R2 or Backblaze B2] - *if offsite backup is set up* | Holds copies of the backups. They are encrypted before they leave the server, with a key the storage provider does not have | [region] |
| [E-mail provider whose SMTP server the Business configures] - *if e-mail is enabled* | Sends statements, receipts and reminders: the recipient's address, name and the document | [location] |
| Let's Encrypt (Internet Security Research Group) | Issues the HTTPS certificate for the Business's address. Receives the address (domain name) only, no personal information | United States |
| Telegram Messenger Inc. - *if a daily summary webhook is set up* | Receives the daily sales summary. Totals only; no customer or staff details | [region] |
| Functional Software, Inc. (Sentry) - *if enabled* | Error reports, which may include the page or request where an error occurred | [region] |

If the Business links its branches (the hub), each linked branch receives the
summaries and transfers the link is used for. Linked branches are the
Business's own or ones it chose to link; they are not Semivra's sub-processors.

The application loads no fonts, scripts or trackers from third parties, so
opening the menu or the portal sends nothing to anyone but the Business's own
server.

Semivra will give the Business at least **thirty (30) days'** notice before
adding or replacing a sub-processor, and will bind each one to obligations at
least as protective as these. Where a sub-processor is outside the Philippines,
Semivra remains responsible for the information as if it were processed here.

## 5. Personal data breaches

Semivra will notify the Business **without undue delay, and within 24 hours**
of becoming aware of a breach affecting the Business's information, with what
is known about its nature, the information and people affected, and what has
been done - so the Business can notify the NPC and the affected people within
the **72 hours** NPC Circular 16-03 requires. Semivra will cooperate with the
investigation and with any notification.

## 6. Helping the Business with requests

Semivra will help the Business respond to data subjects exercising their rights
(access, correction, erasure, portability, objection) - for example by
exporting or correcting records - and with any privacy impact assessment or NPC
inquiry about the Service.

## 7. Audit

On reasonable notice, the Business may ask Semivra for the information needed
to show compliance with this agreement, and may audit it once a year, or after
a breach.

## 8. When the agreement ends

Within **thirty (30) days** of the end of the Service, Semivra will, at the
Business's choice, return the Business's information in a usable export
(the system's full backup workbook) and then delete it, including from backups
as they expire - unless the law requires Semivra itself to keep something, in
which case it keeps only that, only as long as required, and keeps it
protected.

## 9. General

This agreement forms part of the service agreement between the parties and
prevails over it on anything about personal information. It is governed by the
laws of the Republic of the Philippines.

---

For the Business: ____________________ Name / title: ____________________ Date: __________

For Semivra: ____________________ Name / title: ____________________ Date: __________
