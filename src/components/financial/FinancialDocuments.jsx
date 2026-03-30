import { useState } from 'react';
import { Receipt, FilePlus, FileCheck, RotateCcw } from 'lucide-react';
import InvoiceList from './InvoiceList';
import RecurringInvoicePage from './RecurringInvoiceForm';

const TABS = [
  { id: 'invoice', label: 'Invoices', icon: Receipt },
  { id: 'quotation', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
];

export default function FinancialDocuments({ onNavigate, initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'invoice');

  const navigateToNew = {
    invoice: () => onNavigate('invoices'),
    quotation: () => onNavigate('quotations'),
    proforma: () => onNavigate('proforma'),
  };

  return (
    <div className="fin-docs animate-in">
      {/* Tab Bar */}
      <div className="fin-docs-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`fin-docs-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="fin-docs-content">
        {activeTab === 'recurring' ? (
          <RecurringInvoicePage />
        ) : (
          <InvoiceList
            type={activeTab}
            onNavigateToNew={navigateToNew[activeTab]}
          />
        )}
      </div>
    </div>
  );
}
