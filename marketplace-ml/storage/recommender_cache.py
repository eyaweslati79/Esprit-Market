import pickle
import os

CACHE_PATH = "storage/model_cache.pkl"

def save_model(data):
    with open(CACHE_PATH, "wb") as f:
        pickle.dump(data, f)

def load_model():
    if not os.path.exists(CACHE_PATH):
        return None
    with open(CACHE_PATH, "rb") as f:
        return pickle.load(f)