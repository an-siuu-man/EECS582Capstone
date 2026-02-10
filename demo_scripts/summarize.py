import os
from dotenv import load_dotenv

from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

filename = "example.pdf" 

load_dotenv()

CHUNK_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a careful summarizer. Use ONLY the provided text. Do not invent facts."),
    ("human",
     "Summarize the following text chunk.\n\n"
     "Return EXACTLY this format:\n"
     "BULLETS:\n"
     "- Create a bullet point for every significant idea or development in the text.\n"
     "PARAGRAPH:\n"
     "- Write a clear paragraph summarizing the chunk.\n\n"
     "CHUNK:\n\n{chunk}")
])

FINAL_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a careful summarizer. Use ONLY the provided text. Do not invent facts."),
    ("human",
     "You will receive multiple chunk summaries (each contains BULLETS and PARAGRAPH).\n"
     "Create a full-document summary.\n\n"
     "Return EXACTLY this format:\n"
     "BULLETS:\n"
     "- Create a bullet point for every major theme or development across the document. "
     "Do NOT limit the number of bullets.\n"
     "PARAGRAPH:\n"
     "- Write a cohesive paragraph summarizing the entire document.\n\n"
     "CHUNK SUMMARIES:\n\n{chunk_summaries}")
])

def summarize_pdf(file_path: str, model: str = "gpt-4o-mini") -> str:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    docs = PyPDFLoader(file_path).load()

    llm = ChatOpenAI(model=model, temperature=0)
    chunk_chain = CHUNK_PROMPT | llm | StrOutputParser()
    final_chain = FINAL_PROMPT | llm | StrOutputParser()

    # Summarize each chunk
    per_chunk_outputs = []
    for i, d in enumerate(docs, start=1):
        text = d.page_content.strip()
        if not text:
            continue

        chunk_summary = chunk_chain.invoke({"chunk": text})
        per_chunk_outputs.append(f"CHUNK {i}:\n{chunk_summary}")

    # Final combined summary
    all_chunk_summaries = "\n\n".join(per_chunk_outputs)
    final_summary = final_chain.invoke({"chunk_summaries": all_chunk_summaries})

    return (
        "=== PER-CHUNK SUMMARIES ===\n\n"
        + all_chunk_summaries
        + "\n\n=== FINAL DOCUMENT SUMMARY ===\n\n"
        + final_summary
    )

if __name__ == "__main__":
    print(summarize_pdf(filename))
