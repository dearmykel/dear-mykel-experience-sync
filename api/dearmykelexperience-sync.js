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

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE?.trim();
    const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN?.trim();

    // Step 1: Search for customer by email
    const searchUrl = `https://${SHOPIFY_STORE}/admin/api/2025-10/customers/search.json?query=email:${encodeURIComponent(email)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return res.status(500).json({ error: "Shopify search failed", detail: errText });
    }

    const searchData = await searchRes.json();
    if (!searchData.customers?.length) {
      return res.status(404).json({ error: `Customer not found: ${email}` });
    }

    const customerId = searchData.customers[0].id;
    const graphUrl = `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`;

    // Step 2: Build GraphQL metafield mutation
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
            metafields {
              id
              namespace
              key
              value
              type
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
    };

    // Step 3: Send to Shopify
    const graphRes = await fetch(graphUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": ADMIN_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(gqlMutation),
    });

    const graphData = await graphRes.json();

    if (graphData.data?.metafieldsSet?.userErrors?.length) {
      return res.status(500).json({
        error: "Shopify metafield error",
        detail: graphData.data.metafieldsSet.userErrors,
      });
    }

    res.status(200).json({
      ok: true,
      email,
      archetype,
      metafield: graphData.data.metafieldsSet.metafields[0],
    });
  } catch (err) {
    console.error("Fatal server error:", err);
    res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
}
