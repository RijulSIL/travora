import xml.etree.ElementTree as ET
import os

def extract_text():
    try:
        tree = ET.parse('word/document.xml')
        root = tree.getroot()
        
        # XML namespaces
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        
        paragraphs = []
        for p in root.findall('.//w:p', ns):
            texts = [t.text for t in p.findall('.//w:t', ns) if t.text]
            if texts:
                paragraphs.append(''.join(texts))
        
        with open('prd_text.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(paragraphs))
        print("Successfully extracted PRD text to prd_text.txt")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_text()
