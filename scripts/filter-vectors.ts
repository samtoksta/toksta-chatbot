import path from 'path';
import fs from 'fs/promises';

// Define the structure we expect in the JSON file
interface ProductFactWithEmbedding {
    id: string;
    name: string;
    nutshell: string;
    features: string[];
    influencer_count: number; // Assumed present if parsed correctly
    reddit_sentiment_raw: number; // Exists but we don't validate it
    logo_url: string;
    screenshot_urls: string[];
    affiliate_link: string | null;
    website: string;
    subcategory_list: string;
    embedding: number[];
}

const toolsVectorsPath = path.resolve(process.cwd(), 'tools_vectors.json');

// Validation function based on stricter criteria
function isProductDataComplete(product: ProductFactWithEmbedding): boolean {
    let missingFields: string[] = [];

    if (!product.name || product.name.trim().length === 0) missingFields.push('Name');
    if (!product.website || product.website.trim().length === 0) missingFields.push('Website');
    if (!product.nutshell || product.nutshell.trim().length === 0) missingFields.push('Nutshell');
    if (!product.features || product.features.length === 0) missingFields.push('Features (at least 1)');
    // influencer_count should be a number (even 0), checking for null/undefined isn't strictly needed if parsing was correct
    // but we can add a check if needed: if (product.influencer_count === null || product.influencer_count === undefined)
    if (!product.logo_url || product.logo_url.trim().length === 0) missingFields.push('Logo URL');
    if (!product.screenshot_urls || product.screenshot_urls.length === 0) missingFields.push('Screenshots (at least 1)');
    if (!product.subcategory_list || product.subcategory_list.trim().length === 0) missingFields.push('Subcategories');

    if (missingFields.length > 0) {
        console.warn(` -> Skipping product ${product.id} (${product.name || 'No Name'}): Missing required field(s): ${missingFields.join(', ')}.`);
        return false;
    }
    return true;
}

async function filterExistingVectors() {
    console.log(`Reading existing data from ${toolsVectorsPath}...`);
    let products: ProductFactWithEmbedding[] = [];
    try {
        const fileContent = await fs.readFile(toolsVectorsPath, 'utf-8');
        products = JSON.parse(fileContent) as ProductFactWithEmbedding[];
    } catch (error) {
        console.error(`Error reading or parsing ${toolsVectorsPath}:`, error);
        console.error('Please ensure the file exists and is valid JSON.');
        process.exit(1);
    }

    const initialCount = products.length;
    console.log(`Read ${initialCount} products. Applying stricter validation filters...`);

    const filteredProducts = products.filter(isProductDataComplete);

    const finalCount = filteredProducts.length;
    const removedCount = initialCount - finalCount;

    console.log(`Filtering complete. Kept ${finalCount} products, removed ${removedCount}.`);

    if (removedCount > 0) {
        console.log(`Overwriting ${toolsVectorsPath} with the filtered data...`);
        await fs.writeFile(toolsVectorsPath, JSON.stringify(filteredProducts, null, 2));
        console.log(` -> ${toolsVectorsPath} updated successfully.`);
    } else {
        console.log(`No products removed based on criteria. ${toolsVectorsPath} remains unchanged.`);
    }
}

// --- Run the script ---
filterExistingVectors().catch((error) => {
  console.error('Filtering script failed:', error);
  process.exit(1);
}); 