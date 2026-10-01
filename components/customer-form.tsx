"use client";

import { zh } from "@/lib/i18n/zh-cn";
import { useInquiry } from "./inquiry-store";

const fieldClasses =
  "w-full rounded-lg border border-porcelain-300 bg-white px-3 py-2.5 text-base text-porcelain-950 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none";

const labelClasses = "mb-1 block text-sm font-medium text-porcelain-700";

export default function CustomerForm({ disabled }: { disabled?: boolean }) {
  const { customer, updateCustomer } = useInquiry();

  return (
    <section className="rounded-xl border border-porcelain-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-porcelain-600 uppercase">
        {zh.inquiry.customerSection}
      </h2>

      <div className="space-y-3">
        <div>
          <label htmlFor="customer-name" className={labelClasses}>
            {zh.inquiry.customerName}{" "}
            <span className="text-porcelain-400">（{zh.actions.required}）</span>
          </label>
          <input
            id="customer-name"
            type="text"
            value={customer.name}
            onChange={(event) => updateCustomer({ name: event.target.value })}
            placeholder={zh.inquiry.customerName}
            autoComplete="off"
            disabled={disabled}
            className={fieldClasses}
          />
        </div>

        <div>
          <label htmlFor="customer-company" className={labelClasses}>
            {zh.inquiry.companyName}
          </label>
          <input
            id="customer-company"
            type="text"
            value={customer.company}
            onChange={(event) => updateCustomer({ company: event.target.value })}
            placeholder={zh.actions.optional}
            autoComplete="off"
            disabled={disabled}
            className={fieldClasses}
          />
        </div>

          <div>
            <label htmlFor="customer-notes" className={labelClasses}>
            {zh.inquiry.generalNotes}
          </label>
          <textarea
            id="customer-notes"
            value={customer.notes}
            onChange={(event) => updateCustomer({ notes: event.target.value })}
            placeholder={zh.actions.optional}
            rows={3}
            disabled={disabled}
            className={`${fieldClasses} resize-y`}
          />
        </div>
      </div>
    </section>
  );
}
