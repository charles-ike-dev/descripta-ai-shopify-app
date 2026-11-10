import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Descripta AI</h1>
        <p className={styles.text}>
          Product descriptions and SEO copy, written by AI in your brand voice.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Write with AI</strong>. Claude reads each product&apos;s
            facts and writes a description, SEO title and meta description.
          </li>
          <li>
            <strong>Your brand voice</strong>. Set tone, audience, keywords
            and banned claims once, and every page sounds like your store.
          </li>
          <li>
            <strong>Review, apply, undo</strong>. Nothing changes until you
            apply a draft, and every change can be rolled back.
          </li>
        </ul>
      </div>
    </div>
  );
}
