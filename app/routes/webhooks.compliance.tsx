import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../lib/voice.server";

/**
 * Mandatory privacy webhooks for App Store apps.
 * Descripta stores no customer data, only product copy and brand settings,
 * so customer requests need no action and shop/redact removes everything.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;
    case "SHOP_REDACT":
      await deleteShopData(shop);
      break;
  }

  return new Response();
};
