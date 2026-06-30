# Semivra Libellus: Enterprise Cafe POS & ERP

A commercial-grade, local-network (and cloud-ready) QR code digital menu system with real-time order synchronization, automated double-entry accounting, and smart inventory management.

Designed with a minimalist **Black (#111111)** and **Yellow (#FFC107)** UI.



---

## Version History

### v0.2 — ERP & Management Upgrade (Current)
Transformed the basic POS into a fully automated business management suite.

#### Core Features
- **Dual-Mode UI**
  - Toggle between:
    - **SEMIVRA LIBELLUS** (Front-of-house operations)
    - **SEMIVRA NEGOTIUM** (Back-of-house management)
  - Helps protect sensitive data

- **Double-Entry Accounting**
  - Automated General Ledger
  - Each order generates entries for:
    - Cash / E-Wallet / Bank
    - Sales Revenue
    - VAT Payable
    - Cost of Goods Sold (COGS)
  - Supports split payments

- **Smart Inventory (Weighted Average Cost)**
  - Prevents duplicate entries
  - Auto recalculates moving average cost on restock
  - Tracks cost per gram/ml

- **BOM (Bill of Materials) Engine**
  - Links ingredients to menu items
  - Calculates recipe cost and profit margin
  - Estimates remaining servings based on stock

- **Advanced Analytics**
  - Real-time dashboard
  - Daily revenue tracking
  - Best-selling items insights
  - Low-stock / overstock alerts

- **Exporting**
  - CSV export for:
    - Inventory counts
    - General Ledger
    - Sales reports

- **Mobile UX Enhancements**
  - Screen Wake Lock API (keeps screen active)
  - In-page "order ready" notification (fires while the customer tab is open; not server push)

---

### v0.1 — Core POS & Kitchen Display (Legacy)

#### Features
- QR Code Digital Menu
- Real-time Kitchen Display (WebSockets)
- Menu Builder (categories, items, sizes, WebP compression)
- Order Lifecycle:
  - Pending → Preparing → Completed
- Manual Discount & VAT controls

---

## Tech Stack

### Frontend
- React 18
- Vite
- Tailwind CSS

### Backend
- Node.js
- Express.js

### Database
- MongoDB Atlas (Mongoose)

### Real-Time Engine
- Socket.io

### PWA Features
- Service Workers (Push API)
- Navigator Wake Lock API

---

## Setup Instructions

### Prerequisites
- Node.js (v18 or higher)
- MongoDB Atlas Cluster URI
- Static IP address (for local network deployment)

---

### 1. Configure Environment

Create a `.env` file inside the `server` directory:

```env
PORT=5002
MONGO_URI=your_mongodb_connection_string_here
FRONTEND_URL=http://YOUR_LOCAL_IP:3000