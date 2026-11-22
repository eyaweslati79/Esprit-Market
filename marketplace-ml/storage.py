from pymongo import MongoClient

def get_db():
    client = MongoClient("mongodb://localhost:27017/")
    db = client["marketplace_db"]
    
    print("✅ MongoDB connected")
    
    return db