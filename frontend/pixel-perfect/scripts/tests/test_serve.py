import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import serve


class ServeTest(unittest.TestCase):
    def test_serves_files_uncached_and_in_parallel(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "index.html"), "w") as handle:
                handle.write("<p>hello</p>")
            server = serve.make_server(tmp, port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = "http://127.0.0.1:{}/".format(server.server_address[1])
                bodies = []

                def fetch():
                    with urllib.request.urlopen(base + "index.html") as response:
                        bodies.append((response.read(), response.headers["Cache-Control"]))

                workers = [threading.Thread(target=fetch) for _ in range(40)]
                for worker in workers:
                    worker.start()
                for worker in workers:
                    worker.join()
                self.assertEqual(bodies, [(b"<p>hello</p>", "no-store")] * 40)
                with self.assertRaises(urllib.error.HTTPError):
                    urllib.request.urlopen(base + "missing.png")
            finally:
                server.shutdown()
                server.server_close()

    def test_rejects_a_missing_directory(self):
        self.assertEqual(serve.main(["/no/such/directory", "--dry"]), 2)


if __name__ == "__main__":
    unittest.main()
