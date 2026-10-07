"""Serve a directory of static files for capturing.

For projects with no dev server of their own. Unlike `python -m http.server`
it answers requests in parallel with a deep accept queue, so a page with many
images never has a request refused, and it tells the browser not to cache, so
every capture sees the current files. Uses only the standard library.

Runs until it is stopped; start it in the background.
"""
import argparse
import functools
import http.server
import os
import socketserver
import sys


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    request_queue_size = 256
    daemon_threads = True
    allow_reuse_address = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *_):
        pass


def make_server(directory, host="127.0.0.1", port=8765):
    return Server((host, port), functools.partial(Handler, directory=directory))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="serve", description=__doc__)
    parser.add_argument("directory", help="directory to serve")
    parser.add_argument("--port", type=int, default=8765, help="port to listen on; 0 picks a free one")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true", help="check the arguments and stop")
    args = parser.parse_args(argv)
    directory = os.path.abspath(args.directory)
    if not os.path.isdir(directory):
        print("error: {} is not a directory".format(args.directory), file=sys.stderr)
        return 2
    if args.dry:
        print("dry_run: true\ndirectory: {}\nurl: http://{}:{}/".format(directory, args.host, args.port))
        return 0
    try:
        server = make_server(directory, args.host, args.port)
    except OSError as error:
        print("error: cannot listen on {}:{}: {}".format(args.host, args.port, error), file=sys.stderr)
        return 2
    print("directory: {}\nurl: http://{}:{}/".format(directory, args.host, server.server_address[1]), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
