#!/usr/bin/env python3
"""Read-only verification helpers for the Intimcity 'Ваши отзывы' page.

Does not log in, make requests, write forms or submit comments.
"""
from html.parser import HTMLParser
import re
from urllib.parse import urlparse, parse_qs


def normalize_text(text):
    """Normalize HTML whitespace only; do not alter punctuation or casing."""
    return " ".join(str(text).split())


class CommentsParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.card = None
        self.entries = []
        self.capture = None
        self.parts = []
        self.depth = 0
        self.current_review = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = set(a.get("class", "").split())
        if tag == "div" and re.fullmatch(r"ankcrd\d{1,9}", a.get("id", "")):
            self.card = a["id"][6:]
        if tag == "table" and "rating-block-wrapper" in classes and self.card:
            self.current_review = {"profile_id": self.card, "text": ""}
        if self.current_review is not None and tag == "td" and "ver11" in classes:
            self.capture = "review_td"
            self.depth = 1
            self.parts = []
        elif self.capture:
            self.depth += 1
        if self.capture and tag == "p":
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if self.capture:
            self.depth -= 1
            if self.depth == 0:
                if self.current_review is not None:
                    self.current_review["text"] = normalize_text("".join(self.parts))
                self.capture = None
                self.parts = []
        if tag == "table" and self.current_review is not None and self.current_review["text"]:
            self.entries.append(self.current_review)
            self.current_review = None

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)


def find_exact_review(html, profile_id, expected_text):
    """Return a matching visible review or None. Fail closed if ambiguous."""
    pid = str(profile_id)
    if not re.fullmatch(r"\d{1,9}", pid):
        raise ValueError("Invalid profile ID")
    expected = normalize_text(expected_text)
    if len(expected) < 10:
        raise ValueError("Expected text too short")
    parser = CommentsParser()
    parser.feed(html)
    found = [entry for entry in parser.entries
             if entry["profile_id"] == pid and entry["text"] == expected]
    return found[0] if len(found) == 1 else None


def validate_comments_url(url, expected_host):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != expected_host or
            parsed.username or parsed.password or parsed.port or
            parsed.path != "/user_comments.php" or parsed.fragment):
        return False
    query = parse_qs(parsed.query, keep_blank_values=True)
    allowed = {"comments_type", "sort_mycomm", "pageCommentsMy", "itemsPerPageCommentsMy"}
    return not (set(query) - allowed) and all(len(values) == 1 for values in query.values())
