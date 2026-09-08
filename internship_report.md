# Internship Report: Travel & Reimbursement Portal (Travora)

**1. Project Background and Strategic Need:**
The project, Travel & Reimbursement Portal (TRP), addresses the critical business need for Simon India Ltd (SIL) / Adventz Group to digitize their domestic travel claim lifecycle. Previously, the manual or semi-automated processes lacked strict policy enforcement at the source, leading to compliance issues and delayed reimbursements. There was a strategic need for a consolidated platform that integrates corporate travel booking and expense reimbursement, driven by a fully configurable backend policy engine. This ensures all entitlement rules, spending limits, city classifications, and approval workflows are rigorously enforced without requiring developer intervention.

**2. Core Objectives:**
- **Digitisation:** Digitise 100% of the domestic travel claim lifecycle for all SIL offices.
- **Automated Compliance:** Enforce SIL travel policy rules (Impact Level entitlements, hotel room rent caps, food limits) automatically at the source.
- **SLA Enforcement:** Achieve claim settlement within 10 working days, enforcing time-bound SLAs at each approval stage.
- **Configurability:** Enable HR, HRBP, and Finance teams to dynamically configure all policy parameters from a backend admin panel.
- **AI Automation:** Capture GST-compliant invoice data via AI extraction to streamline data entry and auto-validate GSTIN on every invoice.
- **Visibility:** Provide real-time spend dashboards tailored for Finance, HR, and Department Heads.

**3. System Architecture and Design:**
- **Frontend Architecture:** The user interface is a modern Single Page Application (SPA) built with React and Vite, utilizing modular components mapped to specific pages and routing structures.
- **State Management:** Zustand is leveraged for lightweight, global state management (notably for authentication, user sessions, and UI states), ensuring predictable data flow without heavy boilerplate.
- **Backend Architecture:** A high-performance RESTful API developed with FastAPI (Python). It handles complex business logic, real-time policy evaluation, and Role-Based Access Control (RBAC).
- **Data Flow & Storage:** The backend communicates asynchronously via SQLAlchemy ORM to a MySQL 8 database. Alembic manages structured database migrations for the evolving schema.
- **Core Components:**
  - *Policy Engine:* Dynamically evaluates every booking and claim against the employee's Impact Level, destination city group, and expense category.
  - *Approval Workflow Engine:* Manages the standard 4-stage configurable approval chain (Manager → HRBP → Payroll → Finance) including exception routing.
  - *AI Extraction Module:* Parses uploaded receipts/invoices and maps extracted text to the reimbursement form fields.

**4. Technology Stack Rationale:**
- **React & Vite:** Chosen for the frontend to provide a highly responsive, component-based development experience with rapid hot-module replacement and optimized production builds.
- **Tailwind CSS:** Utilized for rapid, utility-first styling to maintain a consistent and modern design system.
- **Zustand:** Selected over Redux for its simplicity and minimalistic approach to global state management.
- **FastAPI (Python):** Chosen for the backend due to its native asynchronous support, exceptional performance, and automatic generation of OpenAPI documentation which aids in rapid frontend-backend integration.
- **MySQL 8 & Async SQLAlchemy:** MySQL provides robust relational data integrity essential for financial and policy data. Async SQLAlchemy prevents I/O blocking, allowing the server to handle concurrent claim uploads efficiently.

**5. Key Features and Functionality:**
- **Dynamic Policy Engine:** Real-time enforcement of travel entitlements based on a configurable matrix of employee grades, impact levels, and city tiers.
- **AI-Powered Invoice Extraction:** Employees upload invoices (images/PDFs) and the system automatically extracts vendor names, GSTIN, line items, and tax amounts.
- **Configurable Approval Matrix:** A flexible workflow that routes claims through a 4-stage approval process with built-in SLAs, escalation rules, and mandatory exception paths (e.g., CEO approval for policy deviations).
- **Travel Booking Enforcement:** A booking module that filters and flags travel options based on entitlements before the booking is confirmed.
- **Role-Specific Dashboards:** Custom views for Employees (claim tracker), Managers (pending approvals queue), HR (compliance heatmaps), and Finance (GST summary and outstanding liabilities).

**6. Challenges and Solutions:**
- **Challenge:** Implementing complex, deeply nested policy rules (Impact Level × City Group × Expense Type) that required real-time validation without hardcoding logic.
  **Solution:** Architected a dynamic, version-controlled policy configuration engine using SQLAlchemy. All rules are stored as versioned database records, and the system dynamically queries the active policy snapshot based on the travel date, allowing HR to update rules via the Admin Console seamlessly.
- **Challenge:** Managing varying degrees of AI extraction accuracy for complex, unstructured Indian GST invoices.
  **Solution:** Introduced a color-coded confidence scoring mechanism (High > 90%, Medium 60–90%, Low < 60%). High-confidence data is auto-filled, while medium/low-confidence data forces explicit employee review and manual correction before the claim can be submitted.
- **Challenge:** Providing smooth visual feedback during heavy data fetching for policy validations and page transitions.
  **Solution:** Integrated a robust loading state architecture across the frontend, utilizing global interceptors and local state indicators to display loading screens during asynchronous API requests, thereby significantly improving the user experience.

**7. Deliverables and Impact:**
- **Deliverables:** A fully functional, responsive enterprise web application comprising a React frontend, FastAPI backend, MySQL database schema, and an AI invoice parsing module. Delivered with comprehensive RBAC and Admin management consoles.
- **Impact:** The portal successfully digitized the end-to-end travel lifecycle for SIL. It ensures 100% policy compliance at the source, significantly reduces manual review time for Finance and HR teams, improves GST ITC reconciliation, and strictly enforces the 10-day claim settlement SLA.
