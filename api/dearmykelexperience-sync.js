/**
 * Dear Mykel Experience Sync
 * Backend API for syncing archetypes to Shopify customer metafields
 * Works with Shopify App Proxy and Vercel Deployment
 */
 // redeploy after restoring package.json

import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// --- Configuration via Environment Variables ---
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const META_NAMESPACE = process.env.META_NAMESPACE || "dearmykelexperience";
const META_KEY = process.env.META_KEY || "archetype";

app.post("/api/dearmykelexperience-sync", async (req, res) => {
  try {
    const { email, archetype } = req.body;

    if (!email || !archetype) {
      return res.status(400).json({ error: "Missing email or archetype." });
    }

    // --- Step 1: Find customer by email ---
    const findRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`,
      {
        headers: {
          "X-Shopify-Access-Token": ADMIN_API_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await findRes.json();
    const customer = data.customers?.[0];

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    // --- Step 2: Create or update metafield ---
    const metafieldPayload = {
      metafield: {
        namespace: META_NAMESPACE,
        key: META_KEY,
        type: "single_line_text_field",
        value: archetype,
      },
    };

    const metaRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/${customer.id}/metafields.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": ADMIN_API_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metafieldPayload),
      }
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      throw new Error(`Metafield write failed: ${errText}`);
    }

    console.log(`✅ Synced archetype for ${email}: ${archetype}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Sync failed:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// --- Vercel Handler ---
export default app;
