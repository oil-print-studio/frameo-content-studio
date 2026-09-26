"use client";

import styles from "./ui.module.css";

export interface PostFormValues {
  topic: string;
  productType: string;
  price: string;
  story: string;
}

export const EMPTY_FORM: PostFormValues = { topic: "", productType: "", price: "", story: "" };

const PRODUCT_SUGGESTIONS = ["유화 캔버스", "수채화 액자", "패브릭 포스터", "원목 액자", "미니 액자"];

interface Props {
  values: PostFormValues;
  onChange: (values: PostFormValues) => void;
}

export function PostForm({ values, onChange }: Props) {
  const set = (key: keyof PostFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...values, [key]: e.target.value });

  return (
    <div className={styles.formFields}>
      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          <span className={styles.step}>3</span>
          <label htmlFor="topic">홍보 주제</label>
          <span className={styles.required}>필수</span>
        </div>
        <input
          id="topic"
          className={styles.input}
          value={values.topic}
          onChange={set("topic")}
          placeholder="예) 부모님 결혼 40주년 사진을 유화 캔버스로"
          maxLength={200}
        />
      </div>

      <details className={styles.optional}>
        <summary>
          <span className={styles.step}>4</span>
          선택 입력 <small>상품 종류 · 가격 · 짧은 사연</small>
        </summary>

        <div className={styles.optionalBody}>
          <div className={styles.field}>
            <label htmlFor="productType" className={styles.subLabel}>
              상품 종류
            </label>
            <input
              id="productType"
              className={styles.input}
              value={values.productType}
              onChange={set("productType")}
              placeholder="예) 유화 캔버스 40×50"
              list="product-suggestions"
              maxLength={60}
            />
            <datalist id="product-suggestions">
              {PRODUCT_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div className={styles.field}>
            <label htmlFor="price" className={styles.subLabel}>
              가격
            </label>
            <input
              id="price"
              className={styles.input}
              value={values.price}
              onChange={set("price")}
              placeholder="예) 89,000원"
              inputMode="text"
              maxLength={40}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="story" className={styles.subLabel}>
              짧은 사연
            </label>
            <textarea
              id="story"
              className={styles.textarea}
              value={values.story}
              onChange={set("story")}
              placeholder="예) 따님이 부모님 결혼기념일 선물로 주문해주셨어요."
              rows={3}
              maxLength={600}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
