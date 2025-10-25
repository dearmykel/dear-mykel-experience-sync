export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email, archetype, first_name, last_name } = body || {};

    if (!email || !archetype) {
      return res.status(400).json({ error: "Missing email or archetype" });
    }

    // ✅ Clean environment setup
    let SHOPIFY_STORE = process.env.SHOPIFY_STORE?.trim();
    if (!SHOPIFY_STORE.startsWith("https://")) {
      SHOPIFY_STORE = `https://${SHOPIFY_STORE}`;
    }

    const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN?.trim();

    if (!SHOPIFY_STORE || !ADMIN_API_TOKEN) {
      return res.status(500).json({ error: "Missing environment variables" });
    }

    // Step 1: Find customer by email
    const searchUrl = `${SHOPIFY_STORE}/admin/api/2025-10/customers/search.json?query=email:${encodeURIComponent(email)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    const searchText = await searchRes.text();
    if (!searchRes.ok) {
      return res.status(500).json({ error: "Shopify search failed", detail: searchText });
    }

    const searchData = JSON.parse(searchText);
    if (!searchData.customers.length) {
      return res.status(404).json({ error: `Customer not found: ${email}` });
    }

    const customerId = searchData.customers[0].id;

    // Step 2: GraphQL mutation
    const graphUrl = `${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`;
    const gqlMutation = {
      query: `
        mutation {
          metafieldsSet(metafields: [{
            ownerId: "gid://shopify/Customer/${customerId}",
            namespace: "dearmykelexperience",
            key: "archetype",
            type: "single_line_text_field",
            value: "${archetype}"
          }]) {
            metafields { id namespace key value type }
            userErrors { field message }
          }
        }
      `,
    };

    const graphRes = await fetch(graphUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(gqlMutation),
    });

    const graphText = await graphRes.text();
    if (!graphRes.ok) {
      return res.status(500).json({ error: "Shopify GraphQL failed", detail: graphText });
    }

    return res.status(200).json({ success: true, data: JSON.parse(graphText) });

  } catch (err) {
    console.error("Sync error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
