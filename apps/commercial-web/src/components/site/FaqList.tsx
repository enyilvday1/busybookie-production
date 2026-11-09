export type FaqItem = {
  question: string;
  answer: string;
};

/** Always-visible questions and answers: nothing is hidden behind hover or toggles. */
export function FaqList({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="faq-list">
      {items.map((item) => (
        <div key={item.question} className="faq-item">
          <h3 className="faq-item__question">{item.question}</h3>
          <p className="faq-item__answer">{item.answer}</p>
        </div>
      ))}
    </div>
  );
}
