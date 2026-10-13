import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from common import Outbox, message_payload


class MessageTests(unittest.TestCase):
    def test_extract_hidden_links(self):
        message = SimpleNamespace(raw_text='中国新闻', id=10, date=datetime.now(timezone.utc), entities=[SimpleNamespace(url='https://reuters.com/news')])
        self.assertEqual(message_payload('xhqcankao', message)['links'], ['https://reuters.com/news'])

    def test_queue_preserves_edits_during_delivery(self):
        with tempfile.TemporaryDirectory() as folder:
            queue = Outbox(Path(folder) / 'queue.db')
            first = {'channel': 'channel', 'messageId': 1, 'text': 'original'}
            changed = {**first, 'text': 'edited'}
            queue.put(first)
            queue.put(changed)
            queue.acknowledge('channel:1', first)
            self.assertEqual(queue.next()[1], changed)
            queue.acknowledge('channel:1', changed)
            self.assertIsNone(queue.next())
            queue.db.close()


if __name__ == '__main__':
    unittest.main()
