# OfferPro | All-in-One Business Suite

A premium, automated business suite for top-tier organizations. Automate hiring, certification, and legal documentation in seconds with professional fidelity.

## 🚀 Features

- **Parallax Landing Page**: Sleek, high-performance entrance with modern aesthetics.
- **Enterprise Auth**: Organization-based management powered by Supabase.
- **Offer Letter Generator**: High-fidelity employment and internship documentation.
- **Certification Suite**: Issue professional achievement certificates with cloud-sync.
- **Cloud Records**: Securely store and manage all issued documents in one place.

## 🛠️ Technology Stack

- **Frontend**: React + Vite
- **Styling**: Vanilla CSS (Custom Design System)
- **Icons**: Lucide React
- **PDF Generation**: jsPDF
- **Backend / Auth**: Supabase

## 🏁 Getting Started

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Environment Setup**:
   Create a `.env` file with your Supabase credentials:

   ```env
   VITE_SUPABASE_URL=your_url
   VITE_SUPABASE_ANON_KEY=your_key
   ```

3. **Run Dev Server**:
   ```bash
   npm run dev
   ```

## 📜 Database Schema

Refer to the `walkthrough.md` in the brain directory for the SQL required to set up the `organizations`, `org_members`, and `records` tables.
