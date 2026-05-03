import sys
import json
import urllib.request
from urllib.error import URLError

# Try to import markdown-it-py (it's essential for parsing the structure)
try:
    from markdown_it import MarkdownIt
except ImportError:
    print("Error: The 'markdown-it-py' library is not installed.")
    print("Run: python -m pip install markdown-it-py")
    sys.exit(1)


def extract_clean_text(token) -> str:
    """
    Extracts pure text from a Markdown token without raw Markdown syntax (like asterisks or link brackets).
    This ensures the LLM reads human-like text rather than raw syntax.
    """
    if getattr(token, "children", None) is None:
        return token.content.strip()
    
    parts = []
    for child in token.children:
        if child.type == "text":
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
        elif child.type == "code_inline":
            parts.append(child.content)
            
    return "".join(parts).strip()


def convert_markdown_to_llm_knowledge_base(md_text: str, source_name: str):
    """
    Parses Markdown and converts it into "Document Chunks" optimized for LLMs.
    Every chunk of text is tied explicitly to the last Markdown header (e.g., # About Us).
    
    Args:
        md_text: Raw markdown text string.
        source_name: Name of the file or URL (for LLM metadata tracking).
        
    Returns:
        List of dictionaries formatted for Vector DBs / LLM context.
    """
    md = MarkdownIt()
    tokens = md.parse(md_text)
    
    knowledge_chunks = []
    
    # Track the current context/header so the LLM knows what this text is about
    current_section_title = "Document Intro/General"
    current_content = []
    
    # Used to prevent adding the exact same paragraph twice
    seen_text = set()
    
    i = 0
    while i < len(tokens):
        token = tokens[i]
        
        # When we detect a heading (e.g. # Services, ## Contact)
        if token.type == "heading_open":
            # 1. Save the previous section into our database list
            if current_content:
                knowledge_chunks.append({
                    "metadata": {
                        "source": source_name,
                        "section_title": current_section_title,
                        "chunk_index": len(knowledge_chunks) + 1,
                        "word_count": len(" ".join(current_content).split())
                    },
                    "content": "\n\n".join(current_content)
                })
            
            # 2. Advance to the next token to get the actual heading text
            i += 1
            if i < len(tokens):
                current_section_title = extract_clean_text(tokens[i])
                current_content = [] # Reset content for the new section
                
        # When we detect standard text (Paragraphs, List items, etc)
        elif token.type == "inline":
            clean_text = extract_clean_text(token)
            
            # Skip empty lines, and ignore duplicate navigation links/footers 
            # (Very common when scraping websites)
            if clean_text and clean_text not in seen_text:
                seen_text.add(clean_text)
                current_content.append(clean_text)
                
        i += 1

    # Don't forget to save the very last section of the document!
    if current_content:
        knowledge_chunks.append({
            "metadata": {
                "source": source_name,
                "section_title": current_section_title,
                "chunk_index": len(knowledge_chunks) + 1,
                "word_count": len(" ".join(current_content).split())
            },
            "content": "\n\n".join(current_content)
        })

    return knowledge_chunks


def process_input_to_json(input_target: str, output_path: str):
    """
    Handles reading from either a File Path or a Web URL, processes it, 
    and exports a pristine JSON file.
    """
    # 1. READ THE FILE OR URL
    try:
        if input_target.startswith("http://") or input_target.startswith("https://"):
            print(f"Fetching from URL: {input_target}")
            # Use headers to bypass basic bot-blockers
            req = urllib.request.Request(
                input_target, 
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req) as response:
                md_text = response.read().decode('utf-8')
        else:
            print(f"Reading from local file: {input_target}")
            with open(input_target, "r", encoding="utf-8") as f:
                md_text = f.read()
                
    except Exception as e:
        print(f"Error reading input '{input_target}': {e}")
        return

    # 2. PROCESS INTO LLM chunks
    knowledge_base = convert_markdown_to_llm_knowledge_base(md_text, source_name=input_target)

    # 3. EXPORT TO JSON
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            # indent=4 creates the standard formatting that is easy to read
            json.dump(knowledge_base, f, indent=4, ensure_ascii=False)
            
        print("\n--- Success! ---")
        print(f"Extracted {len(knowledge_base)} knowledge chunks.")
        print(f"Exported LLM-ready JSON to: {output_path}")
        
    except Exception as e:
        print(f"Error writing output to '{output_path}': {e}")


import os

def determine_output_path(source_path: str, user_override: str) -> str:
    """Calculates exactly where to drop the exported JSON file."""
    if user_override:
        return user_override
        
    FILENAME = "Structured_Json_file.json"
    
    # If it's a web URL, we can't save it "next to" the website, 
    # so we save it in the current folder where this script is running.
    if source_path.startswith("http://") or source_path.startswith("https://"):
        return os.path.join(os.getcwd(), FILENAME)
        
    # If it's a local file, we save it in the exact same folder as the input file.
    else:
        directory = os.path.dirname(os.path.abspath(source_path))
        return os.path.join(directory, FILENAME)

if __name__ == "__main__":
    # =========================================================================
    # 🎯 PASTE YOUR FILE PATH OR URL HERE 🎯
    # =========================================================================
    # Change the string below to the path of the Markdown file you want to read.
    # You can also use a web hyperlink directly (e.g., "https://example.com/file.md")

    INPUT_SOURCE = r"C:\Users\HAFTAH\Desktop\PERSONAL\PRODUCT\(quantumtravels)site_Database.md"
    
    # -------------------------------------------------------------------------
    # 🎯 WHERE DO YOU WANT TO SAVE IT? (OPTIONAL) 🎯
    # -------------------------------------------------------------------------
    # Leave this as `None` to automatically save the new JSON file in the same 
    # folder as your input file! 
    # Or, change it to an exact path (e.g., r"C:\Desktop\my_data.json")

    OUTPUT_DESTINATION = None
    
    # =========================================================================
    
    print("--- LLM Knowledge Base Generator ---")
    print(f"Reading from: {INPUT_SOURCE}")
    
    final_output_path = determine_output_path(INPUT_SOURCE, OUTPUT_DESTINATION)
    process_input_to_json(INPUT_SOURCE, final_output_path)
