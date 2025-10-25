export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email, archetype, first_name, last_name, phone } = body || {};

    // 🔒 SAFEGUARD: fill blank archetype so webhook never fails again
    const finalArchetype = archetype && archetype.trim() ? archetype : "Unknown";

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
    const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
    const META_NAMESPACE = process.env.META_NAMESPACE || "dearmykelexperience";
    const META_KEY = process.env.META_KEY || "archetype";

    // --- Step 1: Find or create customer ---
    const searchUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`;
    let findRes = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
    });
    const findData = await findRes.json();

    let customerId;
    if (findData?.customers?.length) {
      customerId = findData.customers[0].id;
    } else {
      const createUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers.json`;
      const createBody = {
        customer: {
          email,
          first_name,
          last_name,
          phone,
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
      customerId = createData.customer?.id;
    }

    // --- Step 2: Update metafield via GraphQL ---
    const gqlUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`;
    const gqlBody = {
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
            value: finalArchetype,
          },
        ],
      },
    };

    const updateRes = await fetch(gqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(gqlBody),
    });

    const updateData = await updateRes.json();
    const errs = updateData.data?.metafieldsSet?.userErrors;

    if (errs?.length) {
      return res.status(400).json({ error: "Shopify metafield error", details: errs });
    }

    return res.status(200).json({
      ok: true,
      customerId,
      metafield: updateData.data.metafieldsSet.metafields[0],
    });
  } catch (err) {
    console.error("❌ Fatal error:", err);
    return res.status(500).json({ error: "Server crash", details: err.message });
  }
}
