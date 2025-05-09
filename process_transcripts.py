import os
from dotenv import load_dotenv
from airtable import Airtable
import json
import time # Added for rate limiting
import traceback # Keep for critical error reporting

# Load environment variables from .env.local (or .env)
load_dotenv(dotenv_path='.env.local')
# If .env.local doesn't exist, it will try to load .env by default or do nothing if neither exist.

# --- Configuration ---
AIRTABLE_BASE_ID = 'apph2kIrj3y6zyvLi'
TRANSCRIPTS_TABLE_ID = 'tblTfxNoB0YcfFjOi' # 'Video Transcripts'
PRODUCTS_TABLE_ID = 'tblRl7dnmPfHDfzh7'    # Table with product details
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY')
REQUEST_DELAY_SECONDS = 0.25 # Approx 4 requests/sec, Airtable limit is often 5/sec

# Field names in 'Video Transcripts' table
TRANSCRIPT_TEXT_FIELD = 'Video Transcript'
PRODUCT_NAMES_LINKED_FIELD = 'Product Name (from Use Case) 2' # Check if populated
PRODUCT_RECORD_IDS_FIELD = 'Record ID (from Use Case)' # List of Record IDs

# Field names in 'Products' table (tblRl7dnmPfHDfzh7)
PRODUCT_NAME_FIELD = 'Product Name'
PRODUCT_AFFILIATE_LINK_FIELD = 'Affiliate Link'
PRODUCT_LINK_FIELD = 'Website Address'
PRODUCT_DESCRIPTION_FIELD = 'Description'
PRODUCT_MAIN_IMAGE_URL_FIELD = 'Main Image URL'
PRODUCT_IMAGE_2_URL_FIELD = 'Image 2 URL'
PRODUCT_IMAGE_3_URL_FIELD = 'Image 3 URL'
PRODUCT_IMAGE_4_URL_FIELD = 'Image 4 URL'

# --- Cache for Product Details ---
product_details_cache = {}

# --- Helper Functions ---
def fetch_and_cache_product_details(product_table, product_record_ids):
    """Fetches details for a list of product record IDs, utilizing a cache."""
    product_details_list = []
    missing_ids = [pid for pid in product_record_ids if pid not in product_details_cache]

    if missing_ids:
        print(f"Fetching details for {len(missing_ids)} new product IDs...")
        # Fetch missing product details (Airtable's API might allow fetching multiple records by ID)
        # For simplicity, fetching one by one with rate limiting
        for i, product_id in enumerate(missing_ids):
            print(f"    Processing missing ID {i+1}/{len(missing_ids)}: {product_id}...")
            try:
                print(f"      Attempting to fetch record for {product_id}...")
                time.sleep(REQUEST_DELAY_SECONDS) # Rate limiting
                product_record = product_table.get(product_id)
                print(f"      Successfully fetched record for {product_id}.")

                if product_record and 'fields' in product_record:
                    fields = product_record['fields']
                    
                    # Prioritize Affiliate Link, fallback to Website Address
                    link = fields.get(PRODUCT_AFFILIATE_LINK_FIELD)
                    if not link: # If Affiliate Link is empty or None, use Website Address
                        link = fields.get(PRODUCT_LINK_FIELD)

                    # Store fetched details in cache
                    product_details_cache[product_id] = {
                        'tool_name': fields.get(PRODUCT_NAME_FIELD),
                        'link': link, # Use the determined link (affiliate or website)
                        'description': fields.get(PRODUCT_DESCRIPTION_FIELD),
                        'images': [
                            fields.get(PRODUCT_MAIN_IMAGE_URL_FIELD),
                            fields.get(PRODUCT_IMAGE_2_URL_FIELD),
                            fields.get(PRODUCT_IMAGE_3_URL_FIELD),
                            fields.get(PRODUCT_IMAGE_4_URL_FIELD)
                        ],
                        'airtable_product_record_id': product_id
                    }
                    # Filter out None values from images
                    product_details_cache[product_id]['images'] = [
                        img for img in product_details_cache[product_id]['images'] if img
                    ]
                    print(f"      Cached details for {product_id}.")
                else:
                    print(f"Warning: Could not fetch details for product ID {product_id} or record has no fields.")
                    product_details_cache[product_id] = None # Cache the failure to avoid refetching
            except Exception as e:
                print(f"Error fetching product details for ID {product_id}: {e}")
                traceback.print_exc()
                product_details_cache[product_id] = None # Cache the error

    # Retrieve details from cache (including newly fetched ones)
    for product_id in product_record_ids:
        detail = product_details_cache.get(product_id)
        if detail: # Only add if details were successfully fetched and cached
            product_details_list.append(detail)

    return product_details_list


def process_transcripts():
    """
    Fetches transcripts, and if they mention products,
    fetches product details and structures the data.
    """
    if not AIRTABLE_API_KEY:
        print("Error: AIRTABLE_API_KEY environment variable not set in process_transcripts.")
        return []

    transcripts_table = Airtable(AIRTABLE_BASE_ID, TRANSCRIPTS_TABLE_ID, api_key=AIRTABLE_API_KEY)
    product_table_for_details = Airtable(AIRTABLE_BASE_ID, PRODUCTS_TABLE_ID, api_key=AIRTABLE_API_KEY)
    
    all_processed_data = []
    
    # --- Phase 1: Scan transcripts and collect IDs ---
    print(f"Phase 1: Scanning all transcripts from '{TRANSCRIPTS_TABLE_ID}' (View: viw2ngMXPguZjul6z)...")
    initial_transcript_data_list = []
    all_mentioned_product_ids = set()

    try:
        all_transcript_records_from_airtable = transcripts_table.get_all(view='viw2ngMXPguZjul6z', fields=[
            TRANSCRIPT_TEXT_FIELD,
            PRODUCT_NAMES_LINKED_FIELD,
            PRODUCT_RECORD_IDS_FIELD
        ])
        total_transcripts_scanned = len(all_transcript_records_from_airtable)
        print(f"  Phase 1: Found {total_transcripts_scanned} raw transcript records to scan.")

        for i, record in enumerate(all_transcript_records_from_airtable):
            if (i + 1) % 100 == 0 or i == 0 or (i+1) == total_transcripts_scanned:
                print(f"    Scanning transcript record {i + 1} of {total_transcripts_scanned}...")

            record_id = record.get('id')
            fields = record.get('fields', {})

            if not record_id:
                # print(f"  Warning: Transcript record missing 'id'. Skipping.")
                continue

            transcript_text = fields.get(TRANSCRIPT_TEXT_FIELD)
            # Check if 'Product Name (from Use Case) 2' is populated, indicating actual product mentions
            product_names_linked = fields.get(PRODUCT_NAMES_LINKED_FIELD) 
            product_record_ids_from_transcript = fields.get(PRODUCT_RECORD_IDS_FIELD)

            if transcript_text and product_names_linked and product_record_ids_from_transcript:
                initial_transcript_data_list.append({
                    'airtable_transcript_record_id': record_id,
                    'transcript_text': transcript_text,
                    'mentioned_product_ids': product_record_ids_from_transcript # Store IDs for now
                })
                for pid in product_record_ids_from_transcript:
                    all_mentioned_product_ids.add(pid)
        
        print(f"  Phase 1: Scan complete. Found {len(initial_transcript_data_list)} transcripts with product mentions.")
        print(f"             Collected {len(all_mentioned_product_ids)} unique product record IDs to fetch.")

    except Exception as e:
        print(f"An error occurred during Phase 1 (Transcript Scan): {e}")
        traceback.print_exc()
        return []

    # --- Phase 2: Fetch and cache unique product details ---
    if not all_mentioned_product_ids:
        print("No product IDs found to fetch details for. Skipping Phase 2 & 3.")
        return []
        
    product_details_list = fetch_and_cache_product_details(product_table_for_details, all_mentioned_product_ids)

    # --- Phase 3: Combine transcript data with cached product details ---
    print(f"Phase 3: Combining transcript data with cached product details...")
    final_data_for_vectorization = []
    total_transcripts_to_combine = len(initial_transcript_data_list)

    for i, temp_transcript_data in enumerate(initial_transcript_data_list):
        if (i + 1) % 100 == 0 or i == 0 or (i + 1) == total_transcripts_to_combine:
            print(f"    Combining data for transcript {i + 1} of {total_transcripts_to_combine}...")
        
        fetched_product_details_for_this_transcript = []
        for product_id in temp_transcript_data['mentioned_product_ids']:
            details = product_details_cache.get(product_id)
            if details: # Only add if details were successfully fetched and cached
                fetched_product_details_for_this_transcript.append(details)
            # else: # Product details might have failed to fetch, or ID was bad
                # print(f"      Warning: Details for product ID {product_id} not found in cache or failed to fetch. Skipping for this transcript.")

        if fetched_product_details_for_this_transcript: # Only add transcript if it has some valid product details
            final_data_for_vectorization.append({
                'airtable_transcript_record_id': temp_transcript_data['airtable_transcript_record_id'],
                'transcript_text': temp_transcript_data['transcript_text'],
                'mentioned_products': fetched_product_details_for_this_transcript
            })
        # else:
            # print(f"    Skipping transcript {temp_transcript_data['airtable_transcript_record_id']} as no valid product details could be associated after fetching.")


    print(f"\nPhase 3: Combination complete.")
    print(f"Total final structured transcripts ready for vectorization: {len(final_data_for_vectorization)}.")
    return final_data_for_vectorization


if __name__ == '__main__':
    # --- Set your API Key ---
    # Make sure to set your AIRTABLE_API_KEY environment variable
    # For example, in your terminal: export AIRTABLE_API_KEY='your_api_key'
    # Or, for testing purposes, you can uncomment and set it here (NOT RECOMMENDED FOR PRODUCTION):
    # AIRTABLE_API_KEY = "YOUR_AIRTABLE_API_KEY" 

    if not AIRTABLE_API_KEY:
        print("Please set the AIRTABLE_API_KEY environment variable before running the script.")
        print("Example: export AIRTABLE_API_KEY='your_actual_api_key' (Linux/macOS) or $Env:AIRTABLE_API_KEY='your_key' (Windows PowerShell)")
    else:
        print(f"Using Airtable Base ID: {AIRTABLE_BASE_ID}")
        print(f"Transcript Table: {TRANSCRIPTS_TABLE_ID}, Product Table: {PRODUCTS_TABLE_ID}")
        print(f"Request delay between product detail fetches: {REQUEST_DELAY_SECONDS}s")
        
        data_for_vectorization = process_transcripts()

        if data_for_vectorization:
            print(f"\n--- Sample of processed data (first record if available, transcript truncated) ---")
            first_item_sample = data_for_vectorization[0].copy() # Avoid modifying original
            if 'transcript_text' in first_item_sample and len(first_item_sample['transcript_text']) > 300:
                first_item_sample['transcript_text'] = first_item_sample['transcript_text'][:300] + "..."
            print(first_item_sample)
            
            # Next steps would be to vectorize 'transcript_text' and the 'mentioned_products'
            # and then store them in Supabase.
            # For example, you might create a combined text string for each transcript
            # that includes the transcript and details of all mentioned products.
            
            # Example of how you might structure the text for embedding for the first item:
            # if data_for_vectorization:
            #     item = data_for_vectorization[0]
            #     text_to_embed = f"Transcript: {item['transcript_text']}\n\n"
            #     for product in item['mentioned_products']:
            #         text_to_embed += f"Mentioned Product: {product.get('tool_name', 'N/A')}\n"
            #         text_to_embed += f"Description: {product.get('description', 'N/A')}\n"
            #         text_to_embed += f"Link: {product.get('link', 'N/A')}\n"
            #         if product.get('images'):
            #             text_to_embed += f"Images: {', '.join(product['images'])}\n"
            #         text_to_embed += "---\n"
            #     print("\n--- Example text for embedding (first record) ---")
            #     print(text_to_embed)

            # --- Save to JSON file ---
            output_filename = "processed_transcripts_with_products.json"
            try:
                with open(output_filename, 'w', encoding='utf-8') as f:
                    json.dump(data_for_vectorization, f, ensure_ascii=False, indent=4)
                print(f"\nSuccessfully saved processed data to {output_filename}")
            except IOError as e:
                print(f"\nError saving data to {output_filename}: {e}")

        else:
            print("\nNo data was processed or suitable for saving. Check Airtable, API key, and view filters.") 