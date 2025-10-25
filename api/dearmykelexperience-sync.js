// Vercel serverless handler: POST /api/dearmykelexperience-sync
// Accepts JSON { email, archetype, first_name?, last_name?, phone? }
// 1) Finds customer by email; if not found, creates one
// 2) Sets metafield: namespace=dearmykelexperience, key=archetype

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email, archetype, first_name, last_name, phone } = body || {};

    if (!email || !archetype) {
      return res.status(400).json({ error: "Missing email or archetype" });
    }

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE;            // e.g. dearmykel-com.myshopify.com
    const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;        // shpat_…
    const META_NAMESPACE = process.env.META_NAMESPACE || "dearmykelexperience";
    const META_KEY = process.env.META_KEY || "archetype";

    // ---- 1) Find customer by email
    const searchUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`;
    let findRes = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
    });
    let findData = await findRes.json();

    let customerId;
    if (findData?.customers?.length) {
      customerId = findData.customers[0].id;
    } else {
      // ---- 2) Create customer if not found
      const createUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers.json`;
      const createBody = {
        customer: {
          email,
          first_name: first_name || undefined,
          last_name: last_name || undefined,
          phone: phone || undefined,
          verified_email: true,
          accepts_marketing: true,
        },
      };
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": ADMIN_API_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createBody),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData?.customer?.id) {
        return res.status(400).json({ error: "Unable to create customer", details: createData });
      }
      customerId = createData.customer.id;
    }

    // ---- 3) Set metafield via GraphQL
    const graphqlUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`;
    const gql = {
      query: `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id namespace key value type }
            userErrors { field message }
          }
        }
      `,
      variables: {
        metafields: [
          {
            ownerId: `gid://shopify/Customer/${customerId}`,
            namespace: META_NAMESPACE,
            key: META_KEY,
            type: "single_line_text_field",
            value: archetype,
          },
        ],
      },
    };

    const updateRes = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(gql),
    });
    const update = await updateRes.json();

    const errs = update?.data?.metafieldsSet?.userErrors;
    if (errs && errs.length) {
      return res.status(400).json({ error: "Shopify metafield error", details: errs });
    }

    return res.status(200).json({
      ok: true,
      customerId,
      metafield: update?.data?.metafieldsSet?.metafields?.[0] || null,
    });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error", details: e?.message });
  }
}
