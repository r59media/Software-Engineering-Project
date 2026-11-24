<div class="cover-page">
  <div class="cover-badge">R59 MEDIA · SOFTWARE ENGINEERING CAPSTONE</div>
  <h1 class="cover-title">Client User Manual</h1>
  <p class="cover-subtitle">Web Platform Guide: Portfolio, Online Booking, & Self-Service Rescheduling</p>
  <div class="cover-divider"></div>
  <div class="cover-meta">
    <p><strong>Platform:</strong> Kevin D Gonzalez Photography (R59 Media)</p>
    <p><strong>System Version:</strong> 2.0 (Production Release)</p>
    <p><strong>Target Audience:</strong> End-Users, Clients, & System Evaluators</p>
    <p><strong>Date:</strong> November 2026</p>
    <p><strong>Status:</strong> Verified & Production-Deployed</p>
  </div>
</div>

<div class="page-break"></div>

# Table of Contents

1. [Executive Summary & System Overview](#1-executive-summary--system-overview)
2. [Platform Access & System Requirements](#2-platform-access--system-requirements)
3. [Visual Storytelling & Interactive Portfolio](#3-visual-storytelling--interactive-portfolio)
   - 3.1 Hero Visual Reel
   - 3.2 3D Camera Lens Transition
   - 3.3 Portfolio Galleries & Inspection View
   - 3.4 PhotoShield™ Asset Protection
4. [Photography Services & Pricing Packages](#4-photography-services--pricing-packages)
5. [Step-by-Step Online Booking Guide](#5-step-by-step-online-booking-guide)
   - Step 1: Selecting a Session Package
   - Step 2: Choosing Date & Time Slot
   - Step 3: Providing Client & Creative Details
   - Step 4: Reviewing Summary & Paying Deposit (Square)
6. [Booking Confirmation & Calendar Integration](#6-booking-confirmation--calendar-integration)
7. [Self-Service Rescheduling Portal (`/reschedule`)](#7-self-service-rescheduling-portal-reschedule)
8. [Direct Inquiries & Custom Projects](#8-direct-inquiries--custom-projects)
9. [Frequently Asked Questions (FAQ)](#9-frequently-asked-questions-faq)
10. [Security, Privacy & Support](#10-security-privacy--support)

---

<div class="page-break"></div>

# 1. Executive Summary & System Overview

The **R59 Media Web Platform** is an enterprise-grade, single-page application (SPA) crafted for professional photographer **Kevin D Gonzalez**. The system combines cinematic visual presentation with a frictionless, automated client engagement engine.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        R59 MEDIA WEB PLATFORM                          │
├─────────────────────┬───────────────────────────┬──────────────────────┤
│  Visual Experience  │   Automated Scheduling    │  E-Commerce Payments │
│  • 3D Lens Shutter  │   • Live Calendar Sync    │  • Square SDK PCI-L1 │
│  • Three.js WebGL   │   • Anti-Collision Engine │  • Apple/Google Pay  │
│  • PhotoShield™ DRM │   • Automated 90-Day Slots│  • Instant Receipts  │
└─────────────────────┴───────────────────────────┴──────────────────────┘
```

### Key Capabilities for Clients
* **Real-Time Booking:** Reserve studio or on-location sessions without back-and-forth emails.
* **Instant Confirmation:** Slot reservation locked with an encrypted deposit processed via Square.
* **Self-Service Rescheduling:** Change appointment dates autonomously up to 24 hours prior to the session.
* **High-Fidelity Viewing:** Inspect curated galleries with smooth WebGL transitions and responsive layouts.

---

# 2. Platform Access & System Requirements

The platform is engineered as a zero-install Progressive Web Application accessible from any modern web browser.

### Supported Environments
| Platform | Supported Browsers | Recommended Minimum Resolution |
| :--- | :--- | :--- |
| **Desktop / Laptop** | Chrome 110+, Safari 16+, Edge 110+, Firefox 115+ | 1280 × 720 px |
| **Mobile (iOS)** | Safari Mobile (iOS 15+), Chrome for iOS | 375 × 667 px |
| **Mobile (Android)** | Chrome Mobile, Samsung Internet | 360 × 640 px |

> **Network Optimization Note:** The platform incorporates intelligent asset streaming. 3D elements and heavy imagery dynamically adapt to network conditions (`Save-Data` headers and 4G/5G/Wi-Fi).

---

<div class="page-break"></div>

# 3. Visual Storytelling & Interactive Portfolio

The website is designed as a cinematic digital studio. Clients experience seamless visual storytelling before committing to a session.

### 3.1 Hero Visual Reel
* **Full-Bleed Showcase:** High-resolution slides featuring Kevin D Gonzalez's core photographic disciplines (Studio Portraits, On-Location, Fashion/Editorial).
* **Direct Navigation:** Jump directly to **"Book Your Session"** or **"Explore My Work"** via high-contrast gold call-to-actions.

### 3.2 3D Camera Lens Transition
* As users scroll past the biography section, an interactive **Three.js 3D camera lens** mounts smoothly into view.
* The camera aperture blades mechanically dilate, creating a physical camera shutter effect that zooms seamlessly into the *Most Recent Photoshoot*.

### 3.3 Portfolio Galleries & Inspection View
* **Curated Filters:** Filter work by **Portraits**, **Events**, or **Editorial**.
* **High-Res Lightbox:** Clicking any photo opens an edge-to-edge inspection modal displaying full tonal range, lighting nuances, and capture context.
* **3D Memory Card Viewer:** An interactive 3D memory card model allows clients to inspect session reels in physical-feel realism.

### 3.4 PhotoShield™ Asset Protection
To protect client privacy and creative copyright, the platform incorporates **PhotoShield™**:
* Prevents unauthorized drag-and-drop image saving.
* Context menus (right-click download) are disabled across image canvases.
* Keyboard inspection shortcuts (`Ctrl+S`, `Cmd+S`, `Ctrl+U`) are intercepted.

---

<div class="page-break"></div>

# 4. Photography Services & Pricing Packages

The platform features transparent, upfront pricing with clearly detailed package deliverables.

| Package | Ideal For | Typical Duration | Deliverables | Deposit Required |
| :--- | :--- | :---: | :--- | :---: |
| **Studio Portraiture** | Professional headshots, creative portraits, model tests | 60–90 min | 15 Retouched High-Res Images, Online Gallery | 30% |
| **On-Location Session** | Environmental portraits, lifestyle, natural light | 90–120 min | 25 Retouched High-Res Images, Full Print Release | 30% |
| **Event Coverage** | Private events, corporate galas, release parties | 2–6 hours | Complete Curated Proofs, 50+ Edited Highlights | 30% |
| **Commercial & Editorial** | Brand campaigns, lookbooks, publication features | Custom | Custom Licensing, Full Retouching Suite | Custom Quote |

> **Note on Custom Requests:** For destination shoots, multi-day campaigns, or commercial licensing, clients can submit a custom inquiry directly through the platform.

---

<div class="page-break"></div>

# 5. Step-by-Step Online Booking Guide

The online booking engine enables clients to book and secure their session in four simple steps.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    STEP 1    │ ──> │    STEP 2    │ ──> │    STEP 3    │ ──> │    STEP 4    │
│   Service    │     │  Date & Time │     │ Client Info  │     │ Deposit & Pay│
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### Step 1: Selecting a Session Package
1. Navigate to the **Booking** section on the homepage (or click *Book Your Session* in the header).
2. Browse the available services using the interactive carousel or card selector.
3. Review package inclusions, base investment, and estimated turnaround time.
4. Click **Select Service** to lock in your choice and proceed.

### Step 2: Choosing Date & Time Slot
1. An interactive monthly calendar highlights dates with confirmed availability.
2. Select your preferred date.
3. The platform displays available start times (e.g., `10:00 AM`, `2:00 PM`, `5:00 PM`).
4. **Collision Protection:** Grayed-out times represent slots already booked by other clients or reserved in Google Calendar.
5. Click your desired time slot, then click **Continue to Details**.

### Step 3: Providing Client & Creative Details
Fill out the client intake form to ensure the photographer can prepare for your session:
* **Full Name & Contact Information:** Email address and phone number for booking updates.
* **Location Preference:** Studio address or proposed on-location venue.
* **Creative Vision & Notes:** Wardrobe ideas, intended usage (LinkedIn, album, agency), or specific lighting preferences.

### Step 4: Reviewing Summary & Paying Deposit
1. **Summary Review:** Review the selected date, start time, total session fee, and required initial deposit.
2. **Secure Square Checkout:** The embedded payment form loads securely from Square CDN (Level 1 PCI-DSS certified):
   * Pay with any major credit or debit card (Visa, MasterCard, Amex, Discover).
   * One-click checkout supported via **Apple Pay** and **Google Pay** on supported devices.
3. Click **Confirm & Pay Deposit**.
4. Once processed, an instant confirmation screen appears with your **Unique Booking Reference Code**.

---

<div class="page-break"></div>

# 6. Booking Confirmation & Calendar Integration

Immediately following successful deposit authorization:

```
                  ┌─────────────────────────────────────────┐
                  │          SUCCESSFUL CHECKOUT            │
                  └────────────────────┬────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        ┌───────────────────────┐             ┌───────────────────────┐
        │ Instant Confirmation  │             │   Automated Email     │
        │ • Booking ID Display  │             │ • Full Summary Receipt│
        │ • Add to Calendar     │             │ • Reschedule Token Link│
        │ • Studio Prep Guide   │             │ • .ICS Calendar File  │
        └───────────────────────┘             └───────────────────────┘
```

### Email Deliverables
* **Transaction Receipt:** Detailed breakdown of session fee, deposit paid, and remaining balance due on shoot day.
* **iCalendar (.ics) Attachment:** One-click import into Apple Calendar, Google Calendar, or Microsoft Outlook with shoot location and notes pre-filled.
* **Rescheduling Token Link:** A confidential, tamper-proof direct link allowing the client to self-manage the booking.

---

# 7. Self-Service Rescheduling Portal (`/reschedule`)

Clients do not need to call or wait for business hours to adjust their booking time.

```
URL: https://r59media.com/reschedule?booking=BK-XXXX&token=YYYY
```

### Rescheduling Rules & Policies
* **Notice Window:** Sessions may be rescheduled free of charge up to **24 hours** prior to the shoot.
* **Security Token:** Rescheduling is protected by a cryptographic token generated at booking. Unauthorized parties cannot alter your appointment.

### How to Reschedule
1. Click the **Reschedule** link in your confirmation email (or visit `/reschedule` and input your Booking ID).
2. The portal displays your existing appointment details and the live calendar.
3. Pick a new available date and time slot.
4. Click **Confirm New Schedule**.
5. Both client and photographer instantly receive updated calendar invites and notification emails. The previous slot is immediately released for other clients.

---

<div class="page-break"></div>

# 8. Direct Inquiries & Custom Projects

For clients requiring specialized photography services outside standard studio packages:

1. Scroll to the **Contact** section at the bottom of the page.
2. Specify the nature of the project (e.g., Commercial Campaign, Fashion Lookbook, Destination Event).
3. Provide target dates, estimated budget, and moodboard/vision links.
4. Submit the inquiry. Kevin D Gonzalez reviews inquiries within 24–48 business hours.

---

# 9. Frequently Asked Questions (FAQ)

### What is the cancellation and refund policy?
Deposits secure the photographer’s dedicated time and block studio availability. Deposits are non-refundable upon cancellation within 24 hours of the shoot. However, clients may reschedule to another available date without penalty when given at least 24 hours advance notice.

### When will I receive my finished photos?
* **Proofing Gallery:** Delivered digitally within 48–72 hours after the shoot.
* **Final Retouched Images:** Delivered in full print-resolution via a private digital download portal within **7 to 14 business days** from selection.

### What should I wear or bring to the session?
A comprehensive session preparation guide is emailed upon booking confirmation. Generally, neutral tones, solid colors, and fitted clothing photograph best. The studio provides a private dressing area and styling mirrors for up to 3 outfit changes.

### Are commercial usage rights included?
All portrait and lifestyle sessions include personal printing and digital usage rights. Commercial and advertising usage licenses are customized based on distribution channels (billboard, digital ads, print publications) and can be added to any invoice.

---

<div class="page-break"></div>

# 10. Security, Privacy & Support

### Payment & Data Security
* **No Raw Financial Storage:** R59 Media does not store, process, or view client credit card numbers. All transactions are securely handled through **Square's Level 1 PCI-Compliant** infrastructure.
* **SSL/TLS Encryption:** All communications across the platform are encrypted via Cloudflare TLS 1.3 with Strict Transport Security (HSTS).

### Client Support Channels
For urgent inquiries, shoot-day directions, or technical assistance:

* **Official Studio Email:** `kevin@r59media.com`
* **Direct Booking Portal:** `https://software-engineering-project.r59mediatesting.workers.dev`
* **Studio Location:** Studio & On-Location (Worldwide Coverage)
* **Operating Hours:** Tuesday – Sunday · 9:00 AM – 7:00 PM EST

---

<div style="text-align: center; margin-top: 60px; color: #888888; font-size: 9pt;">
  <p>© 2026 Kevin D Gonzalez · R59 Media. All Rights Reserved.</p>
  <p>Software Engineering Project Documentation · Production Version 2.0</p>
</div>
